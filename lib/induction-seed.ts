// Starter content for Facilities → Induction, used ONCE to fill a brand-new empty
// environment. Everything here is admin-editable afterwards, and editing this file does
// NOT change a seeded database — same rule as lib/auction-ai-presets.ts. If you want to
// change the wording of a live induction, edit it in the app.
//
// The slides are the company's Induction PowerPoint (19 slides) carried over as-is, with:
//   · British English and the typos fixed ("the the gravel car park", "its is important")
//   · the blank slide 2 and the "Thank You ☺" slide dropped
//   · the four slides that listed first aiders / kits / defibrillators / locations by hand
//     switched to `liveBlock`, so they read the First Aid records instead of going stale
//   · one presenter note flagging a line the H&S team need to decide on (see FIRST_AID_STEPS)

export type SeedSlide = {
  title: string
  subtitle?: string
  body?: string
  videoUrl?: string
  liveBlock?: string
  notes?: string
}

export const SEED_SLIDES: SeedSlide[] = [
  {
    title: "Health & Safety Induction",
    subtitle: "Vectis Auctions — Hambleton Group",
    body:
      "Welcome to Vectis.\n" +
      "This induction covers how we keep everyone safe on site: what the company must do, what is asked of you, and what to do when something goes wrong.\n" +
      "Please ask questions as we go — there is time at the end as well.",
  },
  {
    title: "Objectives of this induction",
    body:
      "- Understand the importance of workplace health and safety.\n" +
      "- Learn our key safety procedures and policies.\n" +
      "- Identify workplace hazards and know how to report them.\n" +
      "- Know what to do in an emergency.",
  },
  {
    title: "Legal responsibilities",
    subtitle: "As an employer",
    body:
      "The Health and Safety at Work Act 1974 requires employers to ensure the health, safety and welfare of their employees, so that people can do their day-to-day jobs with minimal risk of accident or injury.\n" +
      "- Provide a safe and healthy workplace that meets legal standards.\n" +
      "- Carry out regular risk assessments to identify and reduce hazards.\n" +
      "- Provide proper health and safety training to all employees.\n" +
      "- Supply and maintain the necessary safety equipment, including personal protective equipment (PPE) and first aid provision.\n" +
      "- Set out clear policies and procedures for health and safety.\n" +
      "- Monitor and review safety practices regularly.",
  },
  {
    title: "Legal responsibilities",
    subtitle: "As an employee",
    body:
      "- Follow all health and safety policies and procedures provided by the company.\n" +
      "- Use tools, machinery and equipment safely and as instructed.\n" +
      "- Wear personal protective equipment (PPE) when it is required.\n" +
      "- Report hazards, unsafe practices, incidents and near misses immediately to your supervisor or manager.\n" +
      "- Take part in health and safety training and emergency drills.\n" +
      "- Be aware of your surroundings and the risks around you.\n" +
      "- Take regular breaks to look after your physical and mental wellbeing.",
  },
  {
    title: "Potential workplace hazards",
    subtitle: "What to be aware of at Vectis",
    body:
      "- Slips, trips and falls — uneven flooring, cluttered walkways and wet surfaces.\n" +
      "- Manual handling injuries — lifting and moving auction lots or warehouse stock can cause back strain.\n" +
      "- Stacked inventory — items stored badly can fall and injure someone.\n" +
      "- Fire and electrical risks — electrical equipment, overloaded sockets and misused appliances.\n" +
      "- Stress and fatigue — tight deadlines affect concentration, and that raises the chance of an accident.\n" +
      "- Vehicles and loading — forklifts and the loading and unloading of delivery vehicles.",
  },
  {
    title: "Reporting procedures",
    body:
      "Why it matters\n" +
      "- Hazards get dealt with promptly.\n" +
      "- It prevents the same thing happening to someone else.\n" +
      "- It keeps the workplace safe for everyone.\n" +
      "\n" +
      "What to report\n" +
      "- Accidents and injuries, however minor.\n" +
      "- Near misses — anything that could have caused harm but did not.\n" +
      "- Unsafe conditions such as spills, damaged equipment or blocked routes.\n" +
      "\n" +
      "How to report\n" +
      "- Tell your supervisor, your manager or the health and safety team straight away, in person or by email.\n" +
      "- We need to know what happened, when and where, who was involved or affected, and anything that contributed to it.\n" +
      "- Reports can be made in confidence where necessary, without fear of repercussions.",
  },
  {
    title: "Who to speak to",
    subtitle: "Report any safety concern to any of these people",
    body:
      "- Jon Gouder — Operations Manager\n" +
      "- Joanne McDonald — Cataloguing Manager\n" +
      "- Lisa Sutherland — Group Director\n" +
      "- Jordan Orange, Chris Hemingway and Jack Collings — Health and Safety team\n" +
      "- Becky Jones — HR",
    notes:
      "Check these names and job titles are still right before each induction — this is the one slide that has to be maintained by hand.",
  },
  {
    title: "Fire and emergency",
    body:
      "Emergency exits are shown to you straight after this presentation. The main exits are through reception, or the warehouse doors in the cataloguing room and the accounts corridor.\n" +
      "The assembly point is outside the security gate, in the gravel car park at the front of the building.\n" +
      "Fire alarm call points are located throughout the building — please make yourself familiar with the nearest ones as you go round. Fire signage is displayed in most doorways.\n" +
      "The clocking-in system produces the roll-call used when the alarm sounds. Clock out whenever you leave, otherwise we will believe you are still inside the building and go looking for you.",
  },
  {
    title: "Fire equipment",
    subtitle: "Five types, located throughout the building",
    body:
      "- Water (Class A) — ordinary combustibles such as wood and paper.\n" +
      "- Foam (Class A and B) — liquids such as petrol and oil, and solids.\n" +
      "- Dry powder (Class A, B and C) — electrical fires, liquids and gases.\n" +
      "- CO₂ (Class B and C) — electrical fires and flammable liquids.\n" +
      "- Wet chemical (Class F) — cooking oils and fats.\n" +
      "\n" +
      "When to use one\n" +
      "Only if the fire is small, contained and manageable, you have been trained and feel confident, it is still in its early stages, and you have a clear escape route behind you.\n" +
      "\n" +
      "When not to use one\n" +
      "Never tackle a fire that is large or spreading. Do not use an extinguisher where there is heavy smoke, where you have not been trained or are unsure, or where there is any risk of explosion such as a gas leak. Get out and raise the alarm.",
  },
  {
    title: "Where everything is",
    subtitle: "First aid kits and defibrillators are pinned on the plan",
    liveBlock: "SITE_PLAN",
  },
  {
    title: "First aiders",
    subtitle: "Get the attention of the nearest person on this list",
    liveBlock: "FIRST_AIDERS",
  },
  {
    title: "In an emergency",
    body:
      "- Make sure the area is safe for you as well as for the person needing help.\n" +
      "- If the person is seriously injured, unconscious or unresponsive, call 999 immediately. Give your location and describe the situation.\n" +
      "- If the person is unconscious, check whether they are breathing.\n" +
      "- Control any bleeding by applying pressure with a clean cloth, and raise the injured area if you can.\n" +
      "- If they show signs of shock — cold, pale, or breathing rapidly — help them lie down, raise their legs and keep them warm.\n" +
      "- Stay with them. If they become unresponsive but are still breathing, put them in the recovery position and keep watching them.\n" +
      "- When help arrives, tell them everything about the person's condition and what has been done.\n" +
      "\n" +
      "The priority is always to call the emergency services and keep the person safe until professionals arrive.",
    notes:
      "⚠ FOR THE H&S TEAM TO DECIDE: the original slide said not to attempt CPR unless trained. Current UK guidance is that the 999 call handler talks an untrained bystander through chest compressions, so that line has been left out rather than reworded — put it back, or replace it with the wording you want, once the H&S team have agreed.",
  },
  {
    title: "First aid kits",
    subtitle: "The health and safety room holds the backup supplies",
    liveBlock: "KITS",
  },
  {
    title: "Defibrillators",
    body:
      "Anyone may use a defibrillator in an emergency, but get a trained first aider if one is nearby, because they can also give CPR.\n" +
      "Speed is what saves lives. Survival is highest when defibrillation happens within 3 to 5 minutes of collapse — around 50% to 70% — and drops by about 10% for every minute that passes without it.\n" +
      "Please note that some colleagues have pacemakers fitted and have special instructions.",
    videoUrl: "https://www.youtube.com/watch?v=KBeFlwsw784",
    liveBlock: "DEFIBS",
  },
  {
    title: "Manual handling",
    body: "Watch this before lifting or moving anything on site.",
    videoUrl: "https://www.youtube.com/watch?v=WYVIYQiSomk",
  },
  {
    title: "Box cutter safety",
    body: "Box cutters are used all over the building. Watch how to use one safely.",
    videoUrl: "https://www.youtube.com/watch?v=o9DRqLEDiGM",
  },
  {
    title: "Risk assessments",
    body:
      "The company is committed to providing a safe working environment, and employees are responsible for following the safety procedures and guidelines they are given.\n" +
      "Risk assessments are carried out regularly to identify potential hazards. The company is not liable for incidents that arise from an individual failing to follow the safety procedures.\n" +
      "You are encouraged to report any concern or hazard you spot to management. Any risk assessment can be seen on request.",
  },
  {
    title: "Personal effects",
    body:
      "The company is not responsible for the loss, damage or theft of personal belongings brought onto company premises.\n" +
      "Please keep personal items secure and look after your own belongings. The company accepts no liability for personal effects brought to work, whether they are kept in work areas or personal spaces.",
  },
  {
    title: "Data protection",
    body:
      "The company is committed to protecting the privacy and security of personal data, in line with data protection law. Personal information is stored securely, used only for the purpose it was collected for, and shared only with authorised people.\n" +
      "You are responsible for handling personal data appropriately and following the data protection guidelines you are given.",
  },
  {
    title: "Waste and recycling",
    body:
      "The company is committed to proper waste disposal and environmental responsibility.\n" +
      "Please use the designated bins and follow the guidance on recycling and waste segregation. Hazardous materials must be reported and handled according to the safety procedures.",
  },
  {
    title: "Any questions?",
    subtitle: "Then we will walk round the building and complete the forms",
    body:
      "Next:\n" +
      "- A walk round the building — exits, assembly point, alarms, fire equipment, first aid kits and welfare facilities.\n" +
      "- The forms to read and sign on the tablet.",
  },
]

export type SeedForm = {
  key: string
  title: string
  intro?: string
  body?: string
  declaration?: string
  askCompany?: boolean
  askJobTitle?: boolean
  askStartDate?: boolean
  askNotes?: boolean
  items: string[]
}

export const SEED_FORMS: SeedForm[] = [
  {
    // From "Electronic Door Entry System Vectis.docx" + "FOB Terms of use conformation.docx",
    // which were a letter and a separate acceptance form. They are one thing here.
    key: "fob-terms",
    title: "Electronic Access System — Instructions and Terms of Use",
    intro:
      "You have been allocated a swipe card or fob to log yourself in and out of the site. It also lets you into areas where electronic locks are fitted. Please read this, then confirm each point below and sign.",
    body:
      "What the system is for\n" +
      "The data the system collects is used by the wages department, and to produce the evacuation roll-call when the fire alarm activates. It is therefore vital that you use your own card or fob only — never borrow someone else's, and never “piggy-back” through an open door without swiping. Any misuse of the system is taken very seriously and could lead to disciplinary action.\n" +
      "\n" +
      "Looking after your card or fob\n" +
      "If you forget or lose your card or fob, speak to your manager or the health and safety team as soon as possible and a replacement will be arranged. Your card or fob may come in a plastic holder that protects it — do not try to remove it from the holder, and use the lanyard or reel at all times unless you have been told otherwise for safety reasons.\n" +
      "A charge of £15 will be made if a replacement is needed because the card or fob has been lost or mistreated. If the holder wears out through normal use, it is replaced free of charge.\n" +
      "\n" +
      "How to use it\n" +
      "When you arrive in the morning, or come back after being off site, enter through Main Reception and swipe your card or fob over the reader on the wall to your right, labelled “IN”. You will hear a beep and see the lights flash — that tells the system you are here.\n" +
      "When you leave site, swipe over the reader on the pillar to your right, labelled “OUT”. Again you will hear a beep and see the lights flash.\n" +
      "If the fire alarm sounds, leave by the nearest safe emergency exit. You do not need to swipe out on your way out of the building in that situation.",
    declaration:
      "I confirm that I have read the instructions and terms of use above, that I understand them, and that I agree to abide by them.",
    askStartDate: false,
    askNotes: false,
    items: [
      "I will use only my own card or fob, and I will not lend it to anyone or let anyone follow me through a door without swiping.",
      "I understand that misuse of the system could lead to disciplinary action.",
      "I understand that the data is used for wages and for the fire roll-call, and that I must swipe in and out.",
      "I understand that a replacement costs £15 if my card or fob is lost or mistreated.",
      "I know to leave by the nearest safe exit if the alarm sounds, without swiping out.",
    ],
  },
  {
    key: "induction-signoff",
    title: "Health & Safety Induction — Confirmation of Completion",
    intro:
      "Please confirm that each of the following has been covered with you. Tick them individually — if something has not been covered, leave it and say so before you sign.",
    declaration:
      "I confirm the items above have been explained to me and that I have had the opportunity to ask questions. I understand my responsibilities and agree to follow the health and safety procedures at Vectis Auctions. I understand that if I am ever unsure about a task, or believe something is unsafe, I should stop and ask before continuing.",
    askStartDate: true,
    askNotes: true,
    items: [
      "Why we do this — the purpose of the induction, and that health and safety is everyone's responsibility.",
      "Legal responsibilities — what the company must do under the Health and Safety at Work Act 1974, and what is required of me.",
      "Hazards on this site — slips, trips and falls; manual handling; stacked inventory; fire and electrical risks; stress and fatigue; vehicles, loading and unloading.",
      "Reporting — that I must report accidents and injuries however minor, near misses, and unsafe conditions; who I report them to; and that a report can be made in confidence.",
      "Fire and emergency — where the alarms and fire equipment are, which extinguisher is for what, and that I should only tackle a fire if it is small, contained, I am trained, and I have a clear way out.",
      "Emergency exits and assembly point — I have been shown the exits and the assembly point.",
      "Clocking in and out — that the fob system produces the fire roll-call, so failing to clock out means we believe I am still in the building.",
      "First aid — who the first aiders are, where the kits are, where the two defibrillators are, and what to do while waiting for the emergency services.",
      "Videos watched — defibrillator demonstration, manual handling, and box cutter safety.",
      "Risk assessments — that they are carried out and I can ask to see any of them.",
      "Personal effects — the company is not liable for personal belongings brought on site.",
      "Data protection — my responsibilities when handling personal data.",
      "Waste and recycling — correct disposal, and that hazardous materials must be reported.",
      "Building access fob — issued to me, and I have separately read and accepted the Electronic Access System terms of use.",
      "Site walk round — I have been walked round the building: exits, assembly point, alarms, fire equipment, first aid kits and welfare facilities.",
    ],
  },
]
