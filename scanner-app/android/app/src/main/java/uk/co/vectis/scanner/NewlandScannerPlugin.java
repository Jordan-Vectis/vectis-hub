package uk.co.vectis.scanner;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Build;
import android.os.SystemClock;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import org.json.JSONObject;

/**
 * Delivers hardware scans to the Hub's /scan page as "scan" events: { code, source }.
 *
 * Newland's Android scanners (MT65, MT90, MT93, N7, NFT10, …) have a system scan service. Out of
 * the box it TYPES each scan into whatever box has focus; told to "output via API" it instead sends
 * every scan as a broadcast, which this plugin receives. That is what stops a scan landing in the
 * wrong box: the page gets the code as an event, whatever has focus.
 *
 * Newland's interface, from the Newland Android PDA API Handbook (V1.07) and Newland's own
 * ScanDemo sample (github.com/NewlandAutoID/ScanDemo):
 *   - result broadcast "nlscan.action.SCANNER_RESULT": the code in extra "SCAN_BARCODE1" (String;
 *     raw bytes in "scan_result_one_bytes"), "SCAN_STATE" = "ok" | "fail" (a failed read, e.g.
 *     timed out, sent when "Send Scan Fail Broadcast" is on — ignored here);
 *   - settings broadcast "ACTION_BAR_SCANCFG" (at most 3 settings a broadcast), extra
 *     "EXTRA_SCAN_MODE": 1 = fill in EditText directly (factory setting), 2 = simulate keystroke,
 *     3 = output via API (broadcast).
 * Also received: the older scan service broadcast "com.android.server.scannerservice.broadcast"
 * (code in "scannerdata"), and one configurable broadcast/extra for other makes of scanner.
 *
 * While the app is on screen (and "take scans directly" is on, the default) the scan service is
 * told to output by broadcast; when the app leaves the screen it is put back to keyboard output
 * (capacitor.config.ts plugins.NewlandScanner.keyboardOutputMode, default 2 = simulate keystroke)
 * so the device's other apps keep getting scans. On a scanner without the Newland service none of
 * this does anything: the broadcasts go nowhere and the page's keyboard-style input carries on.
 *
 * JS:  isAvailable() → { available, newland, takeScansDirectly, direct, manufacturer, model }
 *      setTakeScansDirectly({ on: boolean }) → { takeScansDirectly, direct }
 *      setCustomBroadcast({ action, extra }) → { action, extra }   (both "" to clear)
 *      addListener("scan", ({ code, source }) => …)
 * With no "scan" listener, a scan is offered as a cancelable window event "vectis-scan"
 * ({ detail: { code, source } }); if no page takes it (preventDefault), a short message says so.
 */
@CapacitorPlugin(name = "NewlandScanner")
public class NewlandScannerPlugin extends Plugin {

    private static final String TAG = "NewlandScanner";

    // Newland scan service.
    static final String NLS_RESULT_ACTION = "nlscan.action.SCANNER_RESULT";
    static final String NLS_EXTRA_BARCODE = "SCAN_BARCODE1";
    static final String NLS_EXTRA_BARCODE_BYTES = "scan_result_one_bytes";
    static final String NLS_EXTRA_STATE = "SCAN_STATE";
    static final String NLS_CONFIG_ACTION = "ACTION_BAR_SCANCFG";
    static final String NLS_EXTRA_SCAN_MODE = "EXTRA_SCAN_MODE";
    static final String NLS_TRIGGER_ACTION = "nlscan.action.SCANNER_TRIG";
    static final int NLS_MODE_FILL_EDITTEXT = 1;
    static final int NLS_MODE_KEYSTROKE = 2;
    static final int NLS_MODE_API = 3;
    /** keyboardOutputMode 0: send nothing when the app leaves the screen. Not a Newland value. */
    static final int NLS_MODE_LEAVE_ALONE = 0;

    // Older scan service.
    static final String LEGACY_RESULT_ACTION = "com.android.server.scannerservice.broadcast";
    static final String LEGACY_EXTRA_BARCODE = "scannerdata";

    private static final String PREFS = "vectis_newland_scanner";
    private static final String PREF_TAKE_DIRECTLY = "takeScansDirectly";
    private static final String PREF_CUSTOM_ACTION = "customAction";
    private static final String PREF_CUSTOM_EXTRA = "customExtra";

    /** The same code arriving on two different broadcasts this close together is one scan. */
    private static final long SAME_SCAN_WINDOW_MS = 250;
    private static final int MAX_CODE_LENGTH = 512;

    // All of these are only touched on the main thread (lifecycle, broadcasts, and the plugin
    // methods, which hop onto it).
    private BroadcastReceiver receiver;
    private boolean registered = false;
    private boolean resumed = false;
    private boolean direct = false; // the scan service has been told to send by broadcast
    private boolean scanSeen = false;
    private String lastCode = null;
    private String lastAction = null;
    private long lastAt = 0;

    @Override
    public void load() {
        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                handleBroadcast(intent);
            }
        };
    }

    // ---- Lifecycle: listen and take scans only while the app is in front ----------------------

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        resumed = true;
        registerScanReceiver();
        if (takeScansDirectly()) {
            switchToBroadcastOutput();
        }
    }

    @Override
    protected void handleOnPause() {
        resumed = false;
        if (direct) {
            restoreKeyboardOutput();
        }
        unregisterScanReceiver();
        super.handleOnPause();
    }

    @Override
    protected void handleOnDestroy() {
        if (direct) {
            restoreKeyboardOutput();
        }
        unregisterScanReceiver();
        super.handleOnDestroy();
    }

    // ---- Methods the page can call ----------------------------------------------------------

    @PluginMethod
    public void isAvailable(final PluginCall call) {
        getBridge()
            .executeOnMainThread(() -> {
                boolean newland = isNewlandDevice();
                JSObject ret = new JSObject();
                ret.put("available", newland || scanSeen || hasNewlandScanService() || !customAction().isEmpty());
                ret.put("newland", newland);
                ret.put("takeScansDirectly", takeScansDirectly());
                ret.put("direct", direct);
                ret.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER);
                ret.put("model", Build.MODEL == null ? "" : Build.MODEL);
                call.resolve(ret);
            });
    }

    @PluginMethod
    public void setTakeScansDirectly(final PluginCall call) {
        final Boolean on = call.getBoolean("on");
        if (on == null) {
            call.reject("Say on: true or on: false.");
            return;
        }
        getBridge()
            .executeOnMainThread(() -> {
                prefs().edit().putBoolean(PREF_TAKE_DIRECTLY, on).apply();
                if (resumed) {
                    if (on && !direct) {
                        switchToBroadcastOutput();
                    } else if (!on && direct) {
                        switchToKeyboardOutput();
                    }
                }
                JSObject ret = new JSObject();
                ret.put("takeScansDirectly", on.booleanValue());
                ret.put("direct", direct);
                call.resolve(ret);
            });
    }

    @PluginMethod
    public void setCustomBroadcast(final PluginCall call) {
        final String action = trimToEmpty(call.getString("action"));
        final String extra = trimToEmpty(call.getString("extra"));
        if (action.isEmpty() != extra.isEmpty()) {
            call.reject("Give both the broadcast action and the extra that holds the code, or neither.");
            return;
        }
        getBridge()
            .executeOnMainThread(() -> {
                prefs().edit().putString(PREF_CUSTOM_ACTION, action).putString(PREF_CUSTOM_EXTRA, extra).apply();
                if (registered) {
                    // Listen for the new action straight away.
                    unregisterScanReceiver();
                    registerScanReceiver();
                }
                JSObject ret = new JSObject();
                ret.put("action", action);
                ret.put("extra", extra);
                call.resolve(ret);
            });
    }

    // ---- Receiving scans --------------------------------------------------------------------

    private void handleBroadcast(Intent intent) {
        if (intent == null || intent.getAction() == null) {
            return;
        }
        final String action = intent.getAction();
        String code;
        String source;
        if (NLS_RESULT_ACTION.equals(action)) {
            String state = intent.getStringExtra(NLS_EXTRA_STATE);
            if (state != null && !"ok".equalsIgnoreCase(state.trim())) {
                return; // a failed read (nothing decoded before the timeout)
            }
            code = intent.getStringExtra(NLS_EXTRA_BARCODE);
            if (isBlank(code)) {
                code = fromBytes(intent.getByteArrayExtra(NLS_EXTRA_BARCODE_BYTES));
            }
            source = "newland";
        } else if (LEGACY_RESULT_ACTION.equals(action)) {
            code = intent.getStringExtra(LEGACY_EXTRA_BARCODE);
            source = "scannerservice";
        } else if (action.equals(customAction()) && !customExtra().isEmpty()) {
            code = intent.getStringExtra(customExtra());
            if (isBlank(code)) {
                code = fromBytes(intent.getByteArrayExtra(customExtra()));
            }
            source = "custom";
        } else {
            return;
        }

        code = clean(code);
        if (code == null) {
            return;
        }
        scanSeen = true;

        long now = SystemClock.elapsedRealtime();
        if (code.equals(lastCode) && !action.equals(lastAction) && now - lastAt < SAME_SCAN_WINDOW_MS) {
            return; // the same scan announced on a second broadcast
        }
        lastCode = code;
        lastAction = action;
        lastAt = now;

        if (!hasListeners("scan")) {
            deliverByWindowEvent(code, source);
            return;
        }
        JSObject data = new JSObject();
        data.put("code", code);
        data.put("source", source);
        notifyListeners("scan", data);
    }

    /**
     * No page has a "scan" listener (the scan screen is still opening, or it couldn't reach the
     * plugin): offer the scan as a cancelable "vectis-scan" window event, { detail: { code, source } }.
     * A page that takes it calls preventDefault(); if none does, say so rather than lose the scan
     * without a word — the scanner's own beep has already told them it read.
     */
    private void deliverByWindowEvent(String code, String source) {
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView == null) {
            tellNotTaken();
            return;
        }
        String js =
            "(function(){try{var e=new CustomEvent('vectis-scan',{cancelable:true,detail:{code:" +
            JSONObject.quote(code) +
            ",source:" +
            JSONObject.quote(source) +
            "}});window.dispatchEvent(e);return e.defaultPrevented===true;}catch(x){return false;}})()";
        try {
            webView.evaluateJavascript(js, (value) -> {
                if (!"true".equals(value)) {
                    tellNotTaken();
                }
            });
        } catch (Exception e) {
            tellNotTaken();
        }
    }

    private void tellNotTaken() {
        try {
            Toast.makeText(getContext(), R.string.scan_not_ready, Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            Logger.debug(TAG, "Couldn't show the scan-not-taken message: " + e.getMessage());
        }
    }

    private void registerScanReceiver() {
        if (registered || receiver == null) {
            return;
        }
        IntentFilter filter = new IntentFilter();
        filter.addAction(NLS_RESULT_ACTION);
        filter.addAction(LEGACY_RESULT_ACTION);
        String custom = customAction();
        if (!custom.isEmpty() && !custom.equals(NLS_RESULT_ACTION) && !custom.equals(LEGACY_RESULT_ACTION)) {
            filter.addAction(custom);
        }
        try {
            // Exported: the broadcasts come from the scan service, which is another app.
            ContextCompat.registerReceiver(getContext(), receiver, filter, ContextCompat.RECEIVER_EXPORTED);
            registered = true;
        } catch (Exception e) {
            Logger.error(TAG, "Couldn't listen for scans", e);
        }
    }

    private void unregisterScanReceiver() {
        if (!registered) {
            return;
        }
        try {
            getContext().unregisterReceiver(receiver);
        } catch (IllegalArgumentException e) {
            // Already gone.
        }
        registered = false;
    }

    // ---- Telling the Newland scan service where to send scans ---------------------------------

    private void switchToBroadcastOutput() {
        sendScanMode(NLS_MODE_API);
        direct = true;
    }

    /**
     * The app is leaving the screen: put the scan service to the output set in
     * plugins.NewlandScanner.keyboardOutputMode — 1, 2 or 3 is sent as it is; 0 sends nothing (the
     * scanner stays on API output). Anything else is treated as 2 (Simulate keystroke).
     */
    private void restoreKeyboardOutput() {
        int mode = getConfig().getInt("keyboardOutputMode", NLS_MODE_KEYSTROKE);
        if (mode == NLS_MODE_LEAVE_ALONE) {
            direct = false;
            return;
        }
        if (mode != NLS_MODE_FILL_EDITTEXT && mode != NLS_MODE_KEYSTROKE && mode != NLS_MODE_API) {
            mode = NLS_MODE_KEYSTROKE;
        }
        sendScanMode(mode);
        direct = false;
    }

    /**
     * "Take scans straight from the scanner" switched OFF on the screen: the person wants the scanner
     * to type, so it gets keyboard output — 1 when that is the configured mode, otherwise 2.
     */
    private void switchToKeyboardOutput() {
        int mode = getConfig().getInt("keyboardOutputMode", NLS_MODE_KEYSTROKE);
        sendScanMode(mode == NLS_MODE_FILL_EDITTEXT ? NLS_MODE_FILL_EDITTEXT : NLS_MODE_KEYSTROKE);
        direct = false;
    }

    private void sendScanMode(int mode) {
        try {
            Intent intent = new Intent(NLS_CONFIG_ACTION);
            intent.putExtra(NLS_EXTRA_SCAN_MODE, mode);
            getContext().sendBroadcast(intent);
        } catch (Exception e) {
            // No Newland scan service (another make of scanner, or a phone): nothing to change.
            Logger.debug(TAG, "Scanner setting not sent: " + e.getMessage());
        }
    }

    // ---- Settings and helpers ---------------------------------------------------------------

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private boolean takeScansDirectly() {
        SharedPreferences p = prefs();
        if (p.contains(PREF_TAKE_DIRECTLY)) {
            return p.getBoolean(PREF_TAKE_DIRECTLY, true);
        }
        return getConfig().getBoolean("takeScansDirectly", true);
    }

    private String customAction() {
        SharedPreferences p = prefs();
        if (p.contains(PREF_CUSTOM_ACTION)) {
            return trimToEmpty(p.getString(PREF_CUSTOM_ACTION, ""));
        }
        return trimToEmpty(getConfig().getString("customAction", ""));
    }

    private String customExtra() {
        SharedPreferences p = prefs();
        if (p.contains(PREF_CUSTOM_EXTRA)) {
            return trimToEmpty(p.getString(PREF_CUSTOM_EXTRA, ""));
        }
        return trimToEmpty(getConfig().getString("customExtra", ""));
    }

    private static boolean isNewlandDevice() {
        String maker = ((Build.MANUFACTURER == null ? "" : Build.MANUFACTURER) + " " + (Build.BRAND == null ? "" : Build.BRAND))
            .toLowerCase(Locale.ROOT);
        String model = Build.MODEL == null ? "" : Build.MODEL.toUpperCase(Locale.ROOT);
        return maker.contains("newland") || model.startsWith("NLS-");
    }

    @SuppressWarnings("deprecation")
    private boolean hasNewlandScanService() {
        try {
            PackageManager pm = getContext().getPackageManager();
            List<ResolveInfo> config = pm.queryBroadcastReceivers(new Intent(NLS_CONFIG_ACTION), 0);
            if (config != null && !config.isEmpty()) {
                return true;
            }
            List<ResolveInfo> trigger = pm.queryBroadcastReceivers(new Intent(NLS_TRIGGER_ACTION), 0);
            return trigger != null && !trigger.isEmpty();
        } catch (Exception e) {
            return false;
        }
    }

    private static String fromBytes(byte[] bytes) {
        if (bytes == null || bytes.length == 0) {
            return null;
        }
        return new String(bytes, StandardCharsets.UTF_8);
    }

    /** Drops control characters (a scanner's Enter / Tab suffix) and surrounding spaces. */
    private static String clean(String raw) {
        if (raw == null) {
            return null;
        }
        StringBuilder sb = new StringBuilder(raw.length());
        for (int i = 0; i < raw.length(); i++) {
            char c = raw.charAt(i);
            if (c >= 0x20 && c != 0x7F) {
                sb.append(c);
            }
        }
        String code = sb.toString().trim();
        if (code.isEmpty() || code.length() > MAX_CODE_LENGTH) {
            return null;
        }
        return code;
    }

    private static boolean isBlank(String s) {
        return s == null || s.trim().isEmpty();
    }

    private static String trimToEmpty(String s) {
        return s == null ? "" : s.trim();
    }
}
