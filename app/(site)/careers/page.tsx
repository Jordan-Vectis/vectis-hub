import { PageBlocks, pageMetadata, publishedPage } from "../page-editor/render"

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

export default async function CareersPage() {
  // The page editor's published version (Website → Pages) when there is one; the built-in design otherwise.
  const page = await publishedPage("careers")
  if (page) return <PageBlocks data={page.data} />
  return (
    <div className="bg-white">

      {/* Hero */}
      <div className="bg-[#1e1f5e] text-white py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <p className="text-[#DB0606] text-xs font-black uppercase tracking-widest mb-3">Join the Team</p>
          <h1 className="text-4xl font-black mb-4">Careers at Vectis</h1>
          <p className="text-white/70 text-lg max-w-2xl">
            Vectis is the largest toy and collectables auction house in the world, processing over 50,000 lots annually
            across more than 90 auctions per year. Our employees are our greatest asset.
          </p>
        </div>
      </div>

      {/* Intro */}
      <div className="max-w-4xl mx-auto px-6 py-12">
        <blockquote className="border-l-4 border-[#DB0606] pl-6 mb-10">
          <p className="text-xl text-gray-700 italic font-medium leading-relaxed">
            &ldquo;Find a job you enjoy doing, and you will never have to work a day in your life.&rdquo;
          </p>
          <footer className="text-gray-500 text-sm mt-2">— Mark Twain</footer>
        </blockquote>
        <p className="text-gray-600 leading-relaxed">
          We are committed to creating a positive and inclusive work environment where everyone can thrive and grow.
          If you share our passion for toys and collectables and want to be part of a world-class specialist auction house,
          we&apos;d love to hear from you.
        </p>
      </div>

      {/* Jobs */}
      <div className="max-w-4xl mx-auto px-6 pb-16 space-y-8">
        <h2 className="text-2xl font-black text-gray-900">Current Vacancies</h2>

        {jobs.map((job, i) => (
          <div key={i} className="border border-gray-200 overflow-hidden">
            {/* Job header */}
            <div className="bg-gray-50 border-b border-gray-200 px-6 py-5 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-black text-[#1e1f5e]">{job.title}</h3>
                <div className="flex flex-wrap gap-3 mt-2">
                  <span className="text-xs font-semibold text-gray-600 bg-white border border-gray-200 px-2.5 py-1">{job.type}</span>
                  {job.hours && <span className="text-xs font-semibold text-gray-600 bg-white border border-gray-200 px-2.5 py-1">{job.hours}</span>}
                </div>
              </div>
              <div className="text-right">
                <p className="text-[#1e1f5e] font-black text-base">{job.salary}</p>
              </div>
            </div>

            {/* Job body */}
            <div className="px-6 py-6 grid sm:grid-cols-2 gap-6">
              <div>
                <p className="text-gray-600 text-sm leading-relaxed mb-5">{job.description}</p>
                <h4 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-2">Key Responsibilities</h4>
                <ul className="space-y-1.5">
                  {job.responsibilities.map((r, j) => (
                    <li key={j} className="flex items-start gap-2 text-sm text-gray-600">
                      <span className="text-[#DB0606] mt-0.5 shrink-0">•</span>
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-5">
                <div>
                  <h4 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-2">Essential Requirements</h4>
                  <ul className="space-y-1.5">
                    {job.essential.map((r, j) => (
                      <li key={j} className="flex items-start gap-2 text-sm text-gray-600">
                        <span className="text-green-600 mt-0.5 shrink-0">✓</span>
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
                {job.desirable.length > 0 && (
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-2">Desirable</h4>
                    <ul className="space-y-1.5">
                      {job.desirable.map((r, j) => (
                        <li key={j} className="flex items-start gap-2 text-sm text-gray-500">
                          <span className="text-blue-400 mt-0.5 shrink-0">+</span>
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div>
                  <h4 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-2">Benefits</h4>
                  <ul className="space-y-1">
                    {job.benefits.map((b, j) => (
                      <li key={j} className="text-sm text-gray-600">{b}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* Apply CTA */}
            <div className="border-t border-gray-100 px-6 py-4 bg-gray-50">
              <a
                href="mailto:admin@vectis.co.uk?subject=Job Application"
                className="inline-block bg-[#1e1f5e] hover:bg-[#28296e] text-white text-xs font-black uppercase tracking-widest px-6 py-2.5 transition-colors"
              >
                Apply for This Role
              </a>
              <span className="text-xs text-gray-400 ml-4">Send your CV to admin@vectis.co.uk</span>
            </div>
          </div>
        ))}

        {/* Contact */}
        <div className="bg-gray-50 border border-gray-200 p-8">
          <h3 className="text-lg font-black text-gray-900 mb-2">Don&apos;t see the right role?</h3>
          <p className="text-gray-600 text-sm mb-4">
            We&apos;re always interested in hearing from talented people who share our passion. Send a speculative
            application and we&apos;ll keep your details on file.
          </p>
          <a
            href="mailto:admin@vectis.co.uk?subject=Speculative Application"
            className="inline-block border border-[#1e1f5e] text-[#1e1f5e] hover:bg-[#1e1f5e] hover:text-white text-xs font-black uppercase tracking-widest px-6 py-2.5 transition-colors"
          >
            Get in Touch
          </a>
        </div>
      </div>
    </div>
  )
}
