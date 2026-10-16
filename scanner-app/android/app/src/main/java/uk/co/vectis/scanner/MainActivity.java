package uk.co.vectis.scanner;

import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.WindowManager;
import android.webkit.WebBackForwardList;
import android.webkit.WebHistoryItem;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AlertDialog;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

/**
 * Vectis Scanner: the Hub's /scan screen in a WebView (Capacitor), plus
 *  - the NewlandScanner plugin, which hands hardware scans to the page;
 *  - the screen kept on while the app is open;
 *  - the Back button: first offered to the page, then back through earlier /scan pages, and
 *    only ever closes the app after asking;
 *  - the Hub's landing pages (where signing in ends up: /hub, /submissions, /) sent back to /scan,
 *    so signing in inside the app returns to the scanner screen, not the whole Hub.
 */
public class MainActivity extends BridgeActivity {

    /**
     * Back is offered to the page first as a cancelable "vectis:back" event on window. A page that
     * can step back within its own flow (cancel a half-done move, say) calls preventDefault().
     */
    private static final String BACK_EVENT_JS =
        "(function(){try{var e=new CustomEvent('vectis:back',{cancelable:true});" +
        "window.dispatchEvent(e);return e.defaultPrevented===true;}catch(x){return false;}})()";

    /** How long to wait for the page to answer before handling Back here instead. */
    private static final long PAGE_ANSWER_MS = 800;

    private AlertDialog exitDialog;
    private int backPress = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(NewlandScannerPlugin.class);
        super.onCreate(savedInstanceState);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        Bridge b = getBridge();
        if (b != null) {
            b.setWebViewClient(new ScannerWebViewClient(b));
        }

        getOnBackPressedDispatcher()
            .addCallback(
                this,
                new OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackPressed() {
                        onBack();
                    }
                }
            );
    }

    @Override
    public void onDestroy() {
        if (exitDialog != null) {
            exitDialog.dismiss();
            exitDialog = null;
        }
        super.onDestroy();
    }

    private void onBack() {
        Bridge b = getBridge();
        final WebView webView = b == null ? null : b.getWebView();
        if (webView == null) {
            confirmExit();
            return;
        }
        final int press = ++backPress;
        final boolean[] handled = { false };
        try {
            webView.evaluateJavascript(BACK_EVENT_JS, (value) -> {
                if (handled[0] || press != backPress) {
                    return;
                }
                handled[0] = true;
                if (!"true".equals(value)) {
                    goBackOrConfirm(webView);
                }
            });
        } catch (Exception e) {
            handled[0] = true;
            goBackOrConfirm(webView);
            return;
        }
        // A page that's busy or stuck mustn't leave Back doing nothing.
        webView.postDelayed(
            () -> {
                if (!handled[0] && press == backPress) {
                    handled[0] = true;
                    goBackOrConfirm(webView);
                }
            },
            PAGE_ANSWER_MS
        );
    }

    /**
     * Back that the page didn't take: step back to the previous /scan page, else ask before closing.
     *
     * ⚠ The offline page leaves dead entries behind: a /scan load that failed is still committed to
     * the history (with /scan's address), Capacitor then opens offline.html after it, and each retry
     * from there fails and adds another pair. So: on the offline page itself Back asks to close
     * (stepping back would only reload a page that can't load and land here again), and entries for
     * the offline page or for the very address already showing are skipped, never stepped back to.
     */
    private void goBackOrConfirm(WebView webView) {
        String offlinePage = offlinePageUrl();
        if (sameAddress(webView.getUrl(), offlinePage)) {
            confirmExit();
            return;
        }
        WebBackForwardList history = webView.copyBackForwardList();
        int current = history.getCurrentIndex();
        WebHistoryItem here = history.getCurrentItem();
        String hereUrl = here == null ? webView.getUrl() : here.getUrl();
        for (int i = current - 1; i >= 0; i--) {
            WebHistoryItem item = history.getItemAtIndex(i);
            String url = item == null ? null : item.getUrl();
            if (url == null || sameAddress(url, offlinePage) || url.equals(hereUrl)) {
                continue;
            }
            if (isScanPage(url)) {
                webView.goBackOrForward(i - current);
                return;
            }
            break; // a page before the scanner (the sign-in page): don't step back out of /scan
        }
        confirmExit();
    }

    private String offlinePageUrl() {
        Bridge b = getBridge();
        return b == null ? null : b.getErrorUrl();
    }

    /** Two addresses for the same page, ignoring any ?query or #fragment. */
    static boolean sameAddress(String a, String b) {
        if (a == null || b == null) {
            return false;
        }
        return stripQuery(a).equalsIgnoreCase(stripQuery(b));
    }

    private static String stripQuery(String url) {
        int cut = url.length();
        int q = url.indexOf('?');
        int h = url.indexOf('#');
        if (q >= 0) {
            cut = Math.min(cut, q);
        }
        if (h >= 0) {
            cut = Math.min(cut, h);
        }
        return url.substring(0, cut);
    }

    /** A page of the Hub's scan screen (/scan or below it) on this build's own Hub. */
    private boolean isScanPage(String url) {
        Bridge b = getBridge();
        String server = b == null ? null : b.getServerUrl();
        if (url == null || server == null) {
            return false;
        }
        Uri page = Uri.parse(url);
        Uri hub = Uri.parse(server);
        String host = hub.getHost();
        String path = page.getPath();
        return (
            "https".equalsIgnoreCase(page.getScheme()) &&
            host != null &&
            host.equalsIgnoreCase(page.getHost()) &&
            path != null &&
            (path.equals("/scan") || path.startsWith("/scan/"))
        );
    }

    private void confirmExit() {
        if (isFinishing()) {
            return;
        }
        if (exitDialog != null && exitDialog.isShowing()) {
            return;
        }
        exitDialog = new AlertDialog.Builder(this)
            .setTitle(R.string.exit_title)
            .setMessage(R.string.exit_message)
            .setNegativeButton(R.string.exit_stay, (dialog, which) -> dialog.dismiss())
            .setPositiveButton(R.string.exit_close, (dialog, which) -> finish())
            .create();
        exitDialog.show();
    }

    /**
     * Capacitor's own WebView client, plus one thing: the Hub's sign-in sends people to its home
     * page (/hub — or /submissions, or /), which in this app should be the scanner screen. Seen
     * here for full page loads and for the Hub's in-page navigation alike.
     */
    static final class ScannerWebViewClient extends BridgeWebViewClient {

        /** Never bounce more often than this, so a page that sends us back can't start a loop. */
        private static final long MIN_GAP_MS = 4000;

        private final Bridge bridge;
        private long lastBounce = 0;

        ScannerWebViewClient(Bridge bridge) {
            super(bridge);
            this.bridge = bridge;
        }

        /**
         * Capacitor opens the offline page (server.errorPath) for ANY HTTP error on the page itself,
         * so a Hub 404 or 403 would read "Can't reach the Hub ... Wi-Fi" and retry for ever. Only a
         * 5xx (the Hub down or restarting) goes to the offline page; a 4xx shows the Hub's own page,
         * which says what is actually wrong.
         */
        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
            if (request != null && request.isForMainFrame() && errorResponse != null && errorResponse.getStatusCode() < 500) {
                return;
            }
            super.onReceivedHttpError(view, request, errorResponse);
        }

        @Override
        public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
            super.doUpdateVisitedHistory(view, url, isReload);
            final String scanUrl = scanScreenInstead(url);
            if (scanUrl == null) {
                return;
            }
            long now = SystemClock.elapsedRealtime();
            if (lastBounce != 0 && now - lastBounce < MIN_GAP_MS) {
                return;
            }
            lastBounce = now;
            view.post(() -> view.loadUrl(scanUrl));
        }

        /** The scanner screen's address if url is one of the Hub's landing pages, else null. */
        private String scanScreenInstead(String url) {
            String server = bridge.getServerUrl();
            if (url == null || server == null) {
                return null;
            }
            Uri page = Uri.parse(url);
            Uri hub = Uri.parse(server);
            if (hub.getHost() == null || !hub.getHost().equalsIgnoreCase(page.getHost())) {
                return null;
            }
            String path = page.getPath() == null ? "" : page.getPath();
            if (path.length() > 1 && path.endsWith("/")) {
                path = path.substring(0, path.length() - 1);
            }
            if (path.isEmpty() || path.equals("/") || path.equals("/hub") || path.equals("/submissions")) {
                return server.replaceAll("/+$", "") + "/scan";
            }
            return null;
        }
    }
}
