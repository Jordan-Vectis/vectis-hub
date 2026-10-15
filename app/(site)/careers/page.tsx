import Link from "next/link"
import { PageBlocks, pageMetadata, publishedPage } from "../page-editor/render"

// Careers on the test website, laid out as vectis.co.uk's: the title with its short navy rule, the
// introduction, the quote centred, "Current Vacancies" centred, then a card per job with an Apply
// button. The words here are the same ones the page editor's seed (page-editor/seeds.ts) carries
// for this page — change them in both places or in neither. The live page opens with a banner
// picture; the test site holds none, so it starts at the title.

export async function generateMetadata() {
  return pageMetadata("careers", {
    title: "Careers",
    description: "Join the team at Vectis — the world's largest toy and collectables auction house. View current vacancies.",
  })
}

const jobs = [
  {
    title: "Auction Packing Assistant",
    salary: "£12.25 per hour",
    type: "Permanent, Full-time",
    hours: null,
    description: "Support the post-auction logistics team by packing and checking customer orders for dispatch, ensuring every lot reaches its new owner safely.",
    responsibilities: [
      "Packing and checking customer orders for dispatch",
      "Preparing paperwork and processing shipping information",
      "Maintaining a clean, safe working environment",
      "Manual handling and warehouse duties",
      "Supporting post-auction logistics operations",
      "Representing the company professionally",
    ],
    essential: [
      "Excellent customer service skills",
      "Strong attention to detail and accuracy",
      "Reliable, motivated team player",
      "Valid UK driving licence",
    ],
    desirable: [
      "Experience in packing or dispatch",
      "Familiarity with shipping hubs",
      "Microsoft Office competency",
    ],
    benefits: ["Free on-site parking"],
  },
  {
    title: "Online Auction Cataloguer",
    salary: "£22,500 – £25,000 per year",
    type: "Permanent, Full-time",
    hours: "Monday – Friday, 09:00 – 17:00",
    description: "Research, describe and value a wide variety of collectables for our online auction catalogues, working as part of our experienced specialist team.",
    responsibilities: [
      "Cataloguing diverse collectables for online auctions",
      "Unpacking collections and sorting into lots",
      "Inputting titles, descriptions and estimates into the auction system",
      "Collaborating with the cataloguing team",
      "Customer liaison regarding collection suitability",
      "Attending exhibitions and promotional events",
      "Supporting marketing messaging consistency",
    ],
    essential: [
      "Good knowledge of collectables",
      "Computer literacy including Microsoft Office",
      "Excellent customer service skills",
      "Strong written and verbal communication",
      "Accuracy and efficiency in a fast-paced environment",
    ],
    desirable: [
      "E-commerce experience",
      "Familiarity with online auction platforms (e.g. eBay)",
    ],
    benefits: ["Company pension", "Concessionary selling rate", "Free on-site parking"],
  },
  {
    title: "Digital Marketing & Sales Executive",
    salary: "£25,000 – £35,000 per year",
    type: "Permanent, Full-time",
    hours: "Monday – Friday, on-site only",
    description: "Lead our digital marketing and sales growth — from SEO and paid campaigns to building relationships with toy and collectables manufacturers worldwide.",
    responsibilities: [
      "Planning and implementing SEO, PPC, email and social media campaigns",
      "Creating engaging website and social content",
      "Managing and optimising paid advertising (Google Ads, Facebook)",
      "Monitoring performance metrics and analytics",
      "Identifying new toy/collectables manufacturing opportunities",
      "Building manufacturer relationships and qualifying leads",
      "Growing LinkedIn presence and proactive lead generation",
      "Preparing proposals and following up on sales enquiries",
    ],
    essential: [
      "Proven digital marketing, sales or business development experience",
      "Understanding of SEO, paid advertising, email and social media",
      "Excellent written and verbal communication skills",
      "Commercial awareness and target-driven approach",
      "Strong organisational skills across multiple projects",
      "Analytical ability to interpret data",
    ],
    desirable: [
      "Toy or collectables sector experience",
      "Paid advertising budget management",
      "CMS experience",
      "Graphic design skills (Canva, Adobe)",
    ],
    benefits: ["Company pension", "Free on-site parking"],
  },
  {
    title: "Online Auction Cataloguer — Dolls & Bears",
    salary: "From £22,500 per year",
    type: "Permanent, Full-time",
    hours: "Monday – Friday, 09:00 – 17:00",
    description: "Specialist cataloguing role focused on dolls, teddy bears and related collectables — including Steiff, Charlie Bears, Merrythought and Barbie.",
    responsibilities: [
      "Cataloguing dolls and bears for online auctions",
      "Identifying and organising collectables into lots",
      "Inputting accurate titles, descriptions and estimates",
      "Supporting other cataloguers during sales",
      "Customer communication regarding collection suitability",
      "Attending exhibitions and events for promotion",
      "Collaborating with the marketing team",
    ],
    essential: [
      "Good knowledge of dolls, bears and collectables",
      "Strong computer literacy including Microsoft Office",
      "Excellent customer service skills",
      "Effective written and verbal communication",
      "Strong attention to detail and organisational skills",
    ],
    desirable: [
      "E-commerce experience",
      "Online auction platform experience (e.g. eBay)",
    ],
    benefits: ["Company pension", "Concessionary selling rate", "Free on-site parking"],
  },
]

/** A small capital sub-heading inside a job card ("KEY RESPONSIBILITIES") with its list under it. */
function JobList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h4 className="vs-caps text-[var(--vs-navy)] mb-2">{title}</h4>
      <ul className="list-disc pl-5 space-y-1.5">
        {items.map(item => <li key={item}>{item}</li>)}
      </ul>
    </div>
  )
}

export default async function CareersPage() {
  // The page editor's published version (Website → Pages) when there is one; the built-in design otherwise.
  const page = await publishedPage("careers")
  if (page) return <PageBlocks data={page.data} />
  return (
    <div className="vs-page">
      <div className="vs-container">
        <p className="mb-6"><Link href="/" className="vs-link vs-link-back vs-link-sm">Back to home</Link></p>
        <p className="vs-kicker mb-2">Join the Team</p>
        <h1 className="vs-h2 vs-rule">Careers at Vectis</h1>

        <div className="max-w-[960px]">
          {/* Intro */}
          <div className="vs-prose mt-8">
            <p className="vs-lead">
              Vectis is the largest toy and collectables auction house in the world, processing over 50,000 lots annually
              across more than 90 auctions per year. Our employees are our greatest asset.
            </p>
            <p>
              We are committed to creating a positive and inclusive work environment where everyone can thrive and grow.
              If you share our passion for toys and collectables and want to be part of a world-class specialist auction house,
              we&apos;d love to hear from you.
            </p>
          </div>

          <blockquote className="my-12 mx-auto max-w-[720px] text-center">
            <p className="vs-h3 italic">
              &ldquo;Find a job you enjoy doing, and you will never have to work a day in your life.&rdquo;
            </p>
            <footer className="vs-caps vs-muted mt-4">— Mark Twain</footer>
          </blockquote>

          {/* Jobs */}
          <h2 className="vs-h2 text-center mb-8">Current Vacancies</h2>

          <div className="space-y-6">
            {jobs.map(job => (
              <article key={job.title} className="vs-card-flat">
                {/* Job header */}
                <header className="vs-band border-b border-[var(--vs-line)] px-5 sm:px-6 py-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                  <div>
                    <h3 className="vs-h4 text-[22px]">{job.title}</h3>
                    <div className="flex flex-wrap gap-2 mt-3">
                      <span className="vs-caps text-[12px] bg-white border border-[var(--vs-line)] px-2.5 py-1">{job.type}</span>
                      {job.hours && <span className="vs-caps text-[12px] bg-white border border-[var(--vs-line)] px-2.5 py-1">{job.hours}</span>}
                    </div>
                  </div>
                  <p className="vs-price">{job.salary}</p>
                </header>

                {/* Job body */}
                <div className="px-5 sm:px-6 py-6 grid gap-8 md:grid-cols-2">
                  <div>
                    <p className="mb-5">{job.description}</p>
                    <JobList title="Key Responsibilities" items={job.responsibilities} />
                  </div>
                  <div className="space-y-6">
                    <JobList title="Essential Requirements" items={job.essential} />
                    {job.desirable.length > 0 && <JobList title="Desirable" items={job.desirable} />}
                    <JobList title="Benefits" items={job.benefits} />
                  </div>
                </div>

                {/* Apply */}
                <footer className="border-t border-[var(--vs-line)] px-5 sm:px-6 py-4 flex flex-wrap items-center gap-x-5 gap-y-2">
                  {/* The subject names the job, as the page editor's Job block does, so the office knows which one it is. */}
                  <a href={`mailto:admin@vectis.co.uk?subject=${encodeURIComponent(`Job Application — ${job.title}`)}`} className="vs-btn">Apply</a>
                  <span className="text-sm vs-muted">Send your CV to admin@vectis.co.uk</span>
                </footer>
              </article>
            ))}

            {/* Contact */}
            <div className="vs-band p-6 sm:p-8">
              <h3 className="vs-h4 mb-2">Don&apos;t see the right role?</h3>
              <p className="mb-5 max-w-[640px]">
                We&apos;re always interested in hearing from talented people who share our passion. Send a speculative
                application and we&apos;ll keep your details on file.
              </p>
              <a href="mailto:admin@vectis.co.uk?subject=Speculative Application" className="vs-btn vs-btn-outline">Get in Touch</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
