// The acceptance policy every user must read + sign once (see components/terms-gate.tsx).
// Bump TERMS_VERSION if the policy text changes — that re-prompts everyone to sign again.

export const TERMS_VERSION = "ipad-aup-2026-07"
export const TERMS_TITLE = "Workplace iPad Acceptable Use Policy"

export type TermsBlock =
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "h"; text: string }        // sub-heading within a section

export type TermsSection = { title: string; blocks: TermsBlock[] }

export const TERMS: TermsSection[] = [
  {
    title: "1. Purpose",
    blocks: [
      { type: "p", text: "The purpose of this policy is to ensure that company issued iPads are used appropriately, securely and solely for legitimate business purposes. This policy is intended to protect company data, maintain productivity, ensure compliance with legal and regulatory requirements and minimise the risk of misuse." },
    ],
  },
  {
    title: "2. Scope",
    blocks: [
      { type: "p", text: "This policy applies to all employees, contractors, temporary staff, agency workers and any other individuals authorised to use company issued iPads or related mobile devices." },
    ],
  },
  {
    title: "3. Ownership of Devices",
    blocks: [
      { type: "p", text: "All iPads issued by the company remain the property of the company at all times. Employees are responsible for the care, security and authorised use of the device while it is in their possession. Company-issued iPads must not be removed from company premises without prior written authorisation from management." },
      { type: "p", text: "The company reserves the right to inspect, manage, update, restrict, or remove access to any company-issued device at any time." },
    ],
  },
  {
    title: "4. Acceptable Use",
    blocks: [
      { type: "p", text: "Company iPads are provided strictly for work related activities, including but not limited to:" },
      { type: "ul", items: [
        "Accessing company systems and software",
        "Completing work duties and tasks",
        "Accessing approved work-related websites and applications",
      ] },
      { type: "p", text: "Personal use of company issued iPads is not permitted under any circumstances unless expressly authorised in writing by management." },
      { type: "p", text: "Employees must not use company devices for personal browsing, entertainment, social media, shopping, private communications, or any non business related activity." },
      { type: "h", text: "Time Recording and Workflow Updates" },
      { type: "p", text: "Employees are expected to provide accurate and honest updates when recording progress within company systems or applications." },
      { type: "p", text: "Staff must not deliberately overstate, exaggerate, or falsely record the amount of time spent on any stage of work or workflow processes. Time recorded for tasks such as research, preparation, processing, or administration must be reasonable, proportionate and reflective of the actual work completed." },
      { type: "p", text: "Where the company application displays timers or time-tracking features, these are currently used for research, operational analysis and process improvement purposes only. The presence of a timer does not permit employees to estimate, inflate, or fabricate time entries for other activities or stages of work." },
      { type: "p", text: "Any deliberate falsification or manipulation of workflow updates, activity records, or time reporting may be treated as misconduct and may result in disciplinary action." },
    ],
  },
  {
    title: "5. Prohibited Use",
    blocks: [
      { type: "p", text: "The following activities are strictly prohibited on company-issued iPads:" },
      { type: "ul", items: [
        "Accessing non-work-related websites during working hours without authorisation",
        "Streaming entertainment content unrelated to work",
        "Accessing, downloading, storing, or sharing inappropriate, offensive, discriminatory, explicit, or illegal material",
        "Using social media for non-work purposes during working hours unless authorised",
        "Installing unauthorised applications or software",
        "Circumventing security settings, filters, or monitoring systems",
        "Using devices for personal business ventures or financial gain",
        "Sharing passwords or allowing unauthorised individuals to use the device",
        "Connecting devices to unapproved external systems or networks",
      ] },
    ],
  },
  {
    title: "6. Monitoring and Tracking",
    blocks: [
      { type: "p", text: "All activity conducted on company issued iPads may be monitored, recorded and reviewed by the company." },
      { type: "p", text: "This includes, but is not limited to:" },
      { type: "ul", items: [
        "Internet browsing activity",
        "Website access history",
        "Application usage",
        "Device location data where applicable",
        "Downloaded or stored content",
        "Network activity and usage logs",
        "Time spent using work related applications and systems, including activity logs and timestamps where available.",
      ] },
      { type: "p", text: "Employees should have no expectation of privacy when using company issued devices." },
      { type: "p", text: "Any attempt to access non work related, inappropriate, restricted, or unauthorised websites or services may be detected through company monitoring systems. Such activity may be investigated and could result in disciplinary action." },
      { type: "p", text: "The company reserves the right to use monitoring tools and security systems to ensure compliance with this policy and to protect company systems, data, and operations." },
    ],
  },
  {
    title: "7. Data Security and Confidentiality",
    blocks: [
      { type: "p", text: "Users must take reasonable steps to protect company data and confidential information at all times." },
      { type: "p", text: "Employees must:" },
      { type: "ul", items: [
        "Keep devices secure and password protected",
        "Not share login credentials",
        "Report lost or stolen devices immediately",
        "Avoid storing confidential information outside approved systems",
        "Ensure devices are locked when unattended",
      ] },
      { type: "p", text: "Any suspected data breach or security incident must be reported immediately to management or the IT department." },
    ],
  },
  {
    title: "8. Software and Application Management",
    blocks: [
      { type: "p", text: "Only approved applications and software may be installed or used on company-issued iPads." },
      { type: "p", text: "The company may remotely:" },
      { type: "ul", items: [
        "Install or remove applications",
        "Apply updates and security settings",
        "Restrict functionality",
        "Reset or wipe devices where necessary",
      ] },
      { type: "p", text: "Employees must not disable security settings or attempt to bypass device management controls." },
    ],
  },
  {
    title: "9. Compliance and Disciplinary Action",
    blocks: [
      { type: "p", text: "Failure to comply with this policy may result in disciplinary action, up to and including:" },
      { type: "ul", items: [
        "Removal of device access",
        "Formal disciplinary procedures",
        "Termination of employment",
        "Legal action where applicable",
      ] },
      { type: "p", text: "Serious misuse involving unlawful activity, data breaches, deliberate misconduct, or falsification of records may be reported to relevant authorities." },
    ],
  },
  {
    title: "10. Policy Review",
    blocks: [
      { type: "p", text: "This policy may be reviewed and updated periodically to ensure ongoing compliance with company requirements, legal obligations, and technological developments." },
      { type: "p", text: "Employees will be informed of any significant changes." },
    ],
  },
]
