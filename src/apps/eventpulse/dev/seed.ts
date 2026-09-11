/**
 * Deterministic demo data.
 *
 * Powers the mock API and the crowd simulator so the app can be run, reviewed
 * and screenshotted end-to-end without a backend or a hall full of phones.
 * Everything is generated from a fixed seed, so a bug seen in a demo is
 * reproducible.
 *
 * Dev-only: nothing here is imported from a release build.
 */

import type {
  Avatar,
  EventDetail,
  EventProfile,
  EventSession,
  EventSummary,
  EventZone,
  PersonCategory,
  Profile,
  ProfileId,
} from '../types';
import { eventCodeFromId } from '../bluetooth/BleProtocol';
import { fnv1a32 } from '../utils/bytes';

export function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length) % items.length];
}

function pickMany<T>(random: () => number, items: readonly T[], count: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    out.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  }
  return out;
}

const FIRST_NAMES = [
  'Priya', 'Rahul', 'Aman', 'Neha', 'Ananya', 'Vikram', 'Sana', 'Arjun', 'Meera', 'Kabir',
  'Divya', 'Rohan', 'Ishita', 'Karan', 'Tara', 'Dev', 'Aisha', 'Nikhil', 'Riya', 'Aditya',
  'Chen', 'Wei', 'Yuki', 'Haruto', 'Mina', 'Jin', 'Sofia', 'Mateo', 'Lucia', 'Diego',
  'Amara', 'Kwame', 'Zainab', 'Omar', 'Layla', 'Yusuf', 'Elena', 'Nikolai', 'Anja', 'Lars',
  'Grace', 'Sam', 'Jordan', 'Riley', 'Casey', 'Morgan', 'Alex', 'Taylor', 'Jamie', 'Quinn',
];

const LAST_NAMES = [
  'Sharma', 'Verma', 'Patel', 'Reddy', 'Iyer', 'Kapoor', 'Nair', 'Bose', 'Rao', 'Malhotra',
  'Chen', 'Wang', 'Tanaka', 'Kim', 'Park', 'Garcia', 'Martinez', 'Silva', 'Okafor', 'Mensah',
  'Hassan', 'Ali', 'Petrov', 'Novak', 'Andersen', 'Lindqvist', 'Fischer', 'Rossi', 'Dubois', 'Costa',
  'Brooks', 'Hayes', 'Bennett', 'Ellis', 'Foster', 'Grant', 'Harper', 'Jensen', 'Knox', 'Lowe',
];

const COMPANIES = [
  'Google', 'Microsoft', 'Amazon', 'Anthropic', 'Stripe', 'Figma', 'Notion', 'Linear', 'Vercel',
  'Datadog', 'Cloudflare', 'Razorpay', 'Zerodha', 'Flipkart', 'Swiggy', 'Zoho', 'Freshworks',
  'Postman', 'BrowserStack', 'Hasura', 'Atlan', 'Chargebee', 'Rippling', 'Ramp', 'Retool',
];

const STARTUPS = [
  'Lumen Labs', 'Northwind AI', 'Kettle', 'Basil', 'Fathom', 'Meridian', 'Tidepool', 'Quarry',
  'Beacon Health', 'Loomly', 'Verdant', 'Orbital', 'Sable', 'Foundry Nine', 'Kindred Systems',
];

const UNIVERSITIES = [
  'IIT Bombay', 'IIT Delhi', 'BITS Pilani', 'NIT Trichy', 'IIIT Hyderabad', 'VIT', 'SRM',
  'Stanford', 'MIT', 'Waterloo', 'TU Munich', 'NUS',
];

interface RoleTemplate {
  category: PersonCategory;
  roles: string[];
  skills: string[];
  interests: string[];
  weight: number;
}

const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    category: 'engineer',
    weight: 30,
    roles: [
      'Software Engineer', 'Senior Software Engineer', 'Staff Engineer', 'Backend Engineer',
      'Frontend Engineer', 'Mobile Engineer', 'Platform Engineer', 'Infrastructure Engineer',
    ],
    skills: ['TypeScript', 'Go', 'Kotlin', 'Swift', 'React', 'React Native', 'Rust', 'Kubernetes', 'BLE', 'Postgres'],
    interests: ['Distributed systems', 'Developer tools', 'Open source', 'Performance', 'Mobile'],
  },
  {
    category: 'data',
    weight: 12,
    roles: ['ML Engineer', 'Data Scientist', 'Research Engineer', 'Data Engineer', 'Applied Scientist'],
    skills: ['Python', 'PyTorch', 'LLMs', 'Vector search', 'Spark', 'Statistics', 'MLOps'],
    interests: ['AI', 'Applied research', 'Healthcare AI', 'Robotics', 'Evaluation'],
  },
  {
    category: 'product',
    weight: 14,
    roles: ['Product Manager', 'Senior Product Manager', 'Group PM', 'Technical PM'],
    skills: ['Discovery', 'Roadmapping', 'Analytics', 'Pricing', 'User research'],
    interests: ['Product', 'Growth', 'Startups', 'Marketplaces', 'AI products'],
  },
  {
    category: 'design',
    weight: 10,
    roles: ['Product Designer', 'Design Lead', 'UX Researcher', 'Brand Designer', 'Design Engineer'],
    skills: ['Figma', 'Prototyping', 'Design systems', 'Motion', 'Accessibility'],
    interests: ['Design systems', 'Spatial UI', 'Typography', 'Craft', 'Accessibility'],
  },
  {
    category: 'founder',
    weight: 10,
    roles: ['Founder', 'Co-founder & CEO', 'Co-founder & CTO', 'Founding Engineer'],
    skills: ['Fundraising', 'Zero to one', 'Hiring', 'GTM', 'Product strategy'],
    interests: ['Startups', 'Seed stage', 'B2B SaaS', 'Climate', 'Fintech'],
  },
  {
    category: 'investor',
    weight: 4,
    roles: ['Investor', 'Principal', 'Partner', 'Angel Investor'],
    skills: ['Diligence', 'Seed investing', 'Market analysis', 'Board support'],
    interests: ['Pre-seed', 'Developer tools', 'AI infrastructure', 'Fintech'],
  },
  {
    category: 'recruiter',
    weight: 6,
    roles: ['Technical Recruiter', 'Head of Talent', 'University Recruiter', 'Hiring Manager'],
    skills: ['Sourcing', 'Interview design', 'Employer branding', 'Compensation'],
    interests: ['Hiring', 'Early careers', 'Team building', 'DEI'],
  },
  {
    category: 'student',
    weight: 10,
    roles: ['CS Undergraduate', 'Masters Student', 'PhD Candidate', 'Research Assistant'],
    skills: ['Python', 'C++', 'Algorithms', 'Machine learning', 'Android'],
    interests: ['Internships', 'Research', 'Hackathons', 'Open source', 'Robotics'],
  },
  {
    category: 'speaker',
    weight: 2,
    roles: ['Keynote Speaker', 'Workshop Host', 'Track Chair'],
    skills: ['Public speaking', 'Systems design', 'Community'],
    interests: ['Developer experience', 'Education', 'Community'],
  },
  {
    category: 'mentor',
    weight: 2,
    roles: ['Hackathon Mentor', 'Technical Advisor', 'Judge'],
    skills: ['Mentoring', 'Architecture review', 'Prototyping'],
    interests: ['Mentoring', 'Hackathons', 'Early-stage teams'],
  },
];

const LOOKING_TO_MEET = [
  'Engineers', 'Founders', 'Investors', 'Designers', 'ML engineers', 'Recruiters', 'Students',
  'Product people', 'Co-founders', 'Mentors', 'Hiring managers', 'Open-source maintainers',
];

const WHY_ATTENDING = [
  'Hiring for my team',
  'Looking for a co-founder',
  'Exploring my next role',
  'Sharing what we built this year',
  'Learning what people are shipping with LLMs',
  'Meeting the folks behind tools I use daily',
  'Finding a hackathon team',
  'Scouting early-stage teams',
  'First conference — say hello!',
];

/**
 * "Ask me about" topics. Deliberately narrower than a skill list — a skill says
 * what someone can do, this says what they would enjoy being interrupted about,
 * which is the thing a stranger actually needs to know.
 */
const ASK_ME_ABOUT = [
  'Bluetooth development',
  'Scaling Postgres',
  'Running an ML platform',
  'Design systems',
  'Hiring engineers',
  'Fundraising a seed round',
  'Local-first apps',
  'Developer tools',
  'Getting into product',
  'Open source maintenance',
  'On-device inference',
  'Accessibility',
];

const PROJECTS = [
  'An on-device retrieval engine',
  'A design system for spatial interfaces',
  'Real-time collaboration infrastructure',
  'A BLE mesh for indoor logistics',
  'Fine-tuning small models for support',
  'Payment orchestration for emerging markets',
  'An open-source profiler for React Native',
];

const PRONOUNS = [undefined, undefined, undefined, 'she/her', 'he/him', 'they/them'];

export function makeAvatar(name: string, index: number): Avatar {
  const hue = fnv1a32(name) % 360;
  // A mix that mirrors reality: most people never upload a photo at an event.
  const kind = index % 7 === 0 ? 'emoji' : index % 3 === 0 ? 'generated' : 'initials';
  return {
    kind,
    avatarId: (fnv1a32(`${name}:${index}`) & 0xffff).toString(16).toUpperCase().padStart(4, '0'),
    hue,
    emoji: kind === 'emoji' ? pick(makeRandom(fnv1a32(name)), ['👩‍💻', '🧑‍🚀', '🦊', '🐙', '🌱', '⚡️', '🛠️']) : undefined,
  };
}

export interface GeneratedAttendee {
  profile: Profile;
  eventProfile: EventProfile;
  /** Where the simulator should place them, in metres relative to the user. */
  x: number;
  y: number;
  speed: number;
}

export function generateAttendees(
  eventId: string,
  count: number,
  seed = 20260101,
): GeneratedAttendee[] {
  const random = makeRandom(seed);
  const out: GeneratedAttendee[] = [];
  const usedNames = new Set<string>();

  const weighted: RoleTemplate[] = [];
  for (const template of ROLE_TEMPLATES) {
    for (let i = 0; i < template.weight; i++) weighted.push(template);
  }

  for (let i = 0; i < count; i++) {
    let name = `${pick(random, FIRST_NAMES)} ${pick(random, LAST_NAMES)}`;
    let guard = 0;
    while (usedNames.has(name) && guard++ < 20) {
      name = `${pick(random, FIRST_NAMES)} ${pick(random, LAST_NAMES)}`;
    }
    usedNames.add(name);

    const template = pick(random, weighted);
    const isStudent = template.category === 'student';
    const isFounder = template.category === 'founder';
    const company = isStudent
      ? pick(random, UNIVERSITIES)
      : isFounder
        ? pick(random, STARTUPS)
        : random() < 0.65
          ? pick(random, COMPANIES)
          : pick(random, STARTUPS);

    const experienceYears = isStudent
      ? Math.floor(random() * 2)
      : 1 + Math.floor(random() * 14);

    const profileId = `p_${eventId}_${i.toString().padStart(4, '0')}`;
    const availabilityRoll = random();

    const profile: Profile = {
      id: profileId,
      userId: `u_${profileId}`,
      name,
      pronouns: pick(random, PRONOUNS),
      role: pick(random, template.roles),
      company,
      category: template.category,
      experienceYears,
      industry: pick(random, ['Software', 'Fintech', 'Healthcare', 'Climate', 'Developer tools', 'Education']),
      skills: pickMany(random, template.skills, 3 + Math.floor(random() * 3)),
      interests: pickMany(random, template.interests, 2 + Math.floor(random() * 3)),
      headline: undefined,
      bio:
        random() < 0.55
          ? `${pick(random, ['Building', 'Working on', 'Obsessed with'])} ${pick(random, PROJECTS).toLowerCase()}.`
          : undefined,
      avatar: makeAvatar(name, i),
      links:
        random() < 0.6
          ? {
              linkedin: `https://linkedin.com/in/${name.toLowerCase().replace(/\s+/g, '-')}`,
              github: random() < 0.5 ? `https://github.com/${name.split(' ')[0].toLowerCase()}` : undefined,
            }
          : undefined,
      version: 1,
      updatedAt: Date.now() - Math.floor(random() * 86_400_000),
    };

    const eventProfile: EventProfile = {
      eventId,
      profileId,
      whyAttending: random() < 0.7 ? pick(random, WHY_ATTENDING) : undefined,
      lookingToMeet: pickMany(random, LOOKING_TO_MEET, 1 + Math.floor(random() * 2)),
      currentProject: random() < 0.4 ? pick(random, PROJECTS) : undefined,
      askMeAbout: random() < 0.55 ? pickMany(random, ASK_ME_ABOUT, 1 + Math.floor(random() * 2)) : undefined,
      availability:
        availabilityRoll < 0.62 ? 'available' : availabilityRoll < 0.85 ? 'maybe' : 'busy',
    };

    // Cluster people around zones rather than scattering uniformly — real halls
    // have knots of people, and the map has to look right in a knot.
    const cluster = Math.floor(random() * 5);
    const clusterCentres = [
      { x: 0, y: 14 },
      { x: -12, y: -4 },
      { x: 13, y: -6 },
      { x: 2, y: -16 },
      { x: 0, y: 0 },
    ];
    const centre = clusterCentres[cluster];
    const spread = cluster === 4 ? 9 : 6;

    out.push({
      profile,
      eventProfile,
      x: centre.x + (random() - 0.5) * spread * 2,
      y: centre.y + (random() - 0.5) * spread * 2,
      speed: random() < 0.35 ? 0 : 0.25 + random() * 0.8,
    });
  }

  return out;
}

const ZONES: EventZone[] = [
  { id: 'z_stage', name: 'Main Stage', kind: 'stage', x: 0, y: 26, radius: 12, icon: '🎤' },
  { id: 'z_networking', name: 'Networking Lounge', kind: 'networking', x: -16, y: -2, radius: 9, icon: '🤝' },
  { id: 'z_food', name: 'Coffee & Food', kind: 'food', x: 18, y: -8, radius: 8, icon: '☕' },
  { id: 'z_sponsors', name: 'Sponsor Booths', kind: 'sponsors', x: 2, y: -24, radius: 11, icon: '🏢' },
  { id: 'z_workshop', name: 'Workshop Room', kind: 'workshop', x: -22, y: 16, radius: 7, icon: '🛠️' },
  { id: 'z_registration', name: 'Registration', kind: 'registration', x: 24, y: 18, radius: 6, icon: '🎟️' },
];

function sessionsFor(startTime: number): EventSession[] {
  const hour = 3_600_000;
  return [
    {
      id: 's1',
      title: 'Building AI agents that actually ship',
      speaker: 'Ananya Rao',
      startTime: startTime + 2 * hour,
      endTime: startTime + 3 * hour,
      zoneId: 'z_stage',
      tags: ['AI', 'Engineering'],
    },
    {
      id: 's2',
      title: 'Spatial interfaces on a phone budget',
      speaker: 'Kabir Nair',
      startTime: startTime + 3 * hour,
      endTime: startTime + 4 * hour,
      zoneId: 'z_workshop',
      tags: ['Design', 'Mobile'],
    },
    {
      id: 's3',
      title: 'From side project to seed round',
      speaker: 'Meera Iyer',
      startTime: startTime + 4.5 * hour,
      endTime: startTime + 5.5 * hour,
      zoneId: 'z_stage',
      tags: ['Startups'],
    },
    {
      id: 's4',
      title: 'Hiring engineers without the theatre',
      speaker: 'Sana Hassan',
      startTime: startTime + 5 * hour,
      endTime: startTime + 6 * hour,
      zoneId: 'z_networking',
      tags: ['Hiring'],
    },
  ];
}

export function generateEvents(now = Date.now()): EventDetail[] {
  const day = 86_400_000;
  const definitions: Array<Omit<EventSummary, 'bleEventCode'> & { zones?: EventZone[] }> = [
    {
      id: 'techfest-2026',
      name: 'TechFest 2026',
      tagline: 'AI • Cloud • Startups',
      description:
        'Three days of talks, workshops and demos from the teams building the tools everyone else uses.',
      organizer: 'TechFest Foundation',
      startTime: now - 2 * 3_600_000,
      endTime: now + 8 * 3_600_000,
      venue: {
        name: 'Convention Hall A',
        address: 'Bengaluru',
        latitude: 12.9592,
        longitude: 77.6974,
        widthMeters: 90,
        heightMeters: 70,
        northOffsetDegrees: 18,
      },
      attendeeCount: 2400,
      bannerHue: 212,
      tags: ['Conference', 'AI', 'Cloud'],
    },
    {
      id: 'buildathon-24h',
      name: 'Buildathon 24h',
      tagline: 'Ship something before sunrise',
      description: 'A 24-hour hackathon. Find a team, find a mentor, find a judge.',
      organizer: 'Buildathon Collective',
      startTime: now + day,
      endTime: now + day + 24 * 3_600_000,
      venue: {
        name: 'Innovation Campus',
        address: 'Hyderabad',
        latitude: 17.4239,
        longitude: 78.3428,
        widthMeters: 60,
        heightMeters: 45,
      },
      attendeeCount: 380,
      bannerHue: 152,
      tags: ['Hackathon', 'Students'],
    },
    {
      id: 'grad-careers-fair',
      name: 'Graduate Careers Fair',
      tagline: 'Meet the teams that are hiring',
      description: '60 companies, 1,200 students, one afternoon.',
      organizer: 'University Careers Service',
      startTime: now + 3 * day,
      endTime: now + 3 * day + 6 * 3_600_000,
      venue: {
        name: 'Sports Hall',
        address: 'Pune',
        latitude: 18.5308,
        longitude: 73.8475,
        widthMeters: 70,
        heightMeters: 40,
      },
      attendeeCount: 1260,
      bannerHue: 28,
      tags: ['Job fair', 'Campus'],
    },
    {
      id: 'seed-night',
      name: 'Seed Night',
      tagline: 'Founders and the people who back them',
      description: 'An evening for pre-seed and seed founders to meet investors and operators.',
      organizer: 'Seed Collective',
      startTime: now + 5 * day,
      endTime: now + 5 * day + 4 * 3_600_000,
      venue: {
        name: 'The Loft',
        address: 'Mumbai',
        latitude: 19.0176,
        longitude: 72.8562,
        widthMeters: 35,
        heightMeters: 25,
      },
      attendeeCount: 210,
      bannerHue: 280,
      tags: ['Startups', 'Investors'],
    },
  ];

  return definitions.map((definition) => ({
    ...definition,
    bleEventCode: eventCodeFromId(definition.id),
    zones: ZONES,
    sessions: sessionsFor(definition.startTime),
  }));
}

/** The signed-in user's own starting profile. */
/**
 * The card a brand-new install starts from.
 *
 * The identity is passed in rather than written here. It used to be the
 * literal `'me'`, which made every install claim the same person the moment it
 * spoke to another phone; minting it belongs to `profile/LocalIdentity.ts`,
 * which persists it separately from the editable profile.
 */
export function defaultUserProfile(profileId: ProfileId): Profile {
  return {
    id: profileId,
    userId: profileId,
    name: 'Yogita Gupta',
    pronouns: 'she/her',
    role: 'Software Engineer',
    company: 'Anslation',
    category: 'engineer',
    experienceYears: 1,
    industry: 'Software',
    skills: ['React', 'AI', 'BLE'],
    interests: ['Startups', 'AI', 'Mobile'],
    bio: 'Building spatial, offline-first mobile experiences.',
    avatar: makeAvatar('Yogita Gupta', 3),
    links: {},
    version: 1,
    updatedAt: Date.now(),
  };
}
