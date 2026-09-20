// cogsec taxonomy — the intents every post is rated on.
// Shared by the extension background worker, the popup, the provider prompt and the CLI (plain ESM, no deps).
//
// Design notes
// - Every intent is judged independently (a 0–3 rating from the model, mapped to a probability).
// - Rubrics carry `what` + `examples` for both sides. The NOT side matters most: reporting an
//   upsetting fact plainly is not manipulation, and the model needs that boundary spelled out.
// - `primary_intent` gives the headline; `pressure` is the Kahneman axis: how much the post relies
//   on a System 1 reflex instead of giving the reader something to check.

export const FRAME =
  'The state is one post from a social-media feed. Judge the post\'s own framing and rhetoric, ' +
  'not its topic and not whether you agree with it. Reporting an upsetting fact plainly is NOT ' +
  'manipulation; wording chosen to bypass the reader\'s judgment IS.';

export const GROUPS = {
  feel: 'Wants you to feel',
  believe: 'Wants you to believe',
  do: 'Wants you to do',
};

export const INTENTS = [
  // ---------------------------------------------------------------- FEEL
  {
    key: 'outrage', group: 'feel', label: 'Outrage',
    hint: 'Get you angry at someone before you think.',
    question: 'Is this post crafted to make the reader angry or indignant at a person or group?',
    yes: {
      what: 'Loaded or contemptuous wording, moral-outrage cues, invitations to be furious, a villain named or implied, context stripped to maximize anger.',
      examples: [
        'They are literally letting criminals walk free and laughing at you.',
        'Absolutely disgusting. This is what they think of you.',
        'Say it louder for the people in the back: they HATE you.',
      ],
    },
    no: {
      what: 'Neutral reporting of an event that happens to be upsetting; personal frustration without a target; criticism with specifics and sources.',
      examples: [
        'City council voted 7-2 to cut the library budget by 12%. Roll call in the link.',
        'My train was late again. Third time this week.',
      ],
    },
  },
  {
    key: 'fear', group: 'feel', label: 'Fear',
    hint: 'Make you anxious about a threat beyond what the facts support.',
    question: 'Is this post crafted to make the reader afraid or anxious about a threat, beyond what its stated facts support?',
    yes: {
      what: 'Catastrophizing, worst case presented as certain, vague looming dangers, "wake up before it is too late", threats to safety, money, children or health with no specifics.',
      examples: [
        'This is the beginning of the end. Prepare now.',
        'They are coming for your savings next and nobody is talking about it.',
        'If you have kids you NEED to see this.',
      ],
    },
    no: {
      what: 'Concrete warnings with specifics and a proportionate tone; safety advisories; someone describing their own worry.',
      examples: [
        'Recall notice: lot 4471 of this formula, check your cans.',
        'Storm expected 6pm to midnight, avoid the coast road.',
      ],
    },
  },
  {
    key: 'contempt', group: 'feel', label: 'Contempt',
    hint: 'Make you see a group or person as stupid, subhuman, or beneath consideration.',
    question: 'Does this post push the reader to feel contempt or disgust toward a group or person as such, treating them as stupid, subhuman, vermin, degenerate, or not worth listening to?',
    yes: {
      what: 'Dehumanizing labels, blanket claims about a whole group\'s intelligence or morals, mockery aimed at identity rather than arguments.',
      examples: [
        'These people are animals, plain and simple.',
        'Imagine being this braindead. Every single one of them.',
        'NPCs. All of them. Not worth arguing with.',
      ],
    },
    no: {
      what: 'Criticism of actions or arguments with reasons; harsh but specific critique of a person\'s stated position.',
      examples: [
        'His argument ignores the 2019 data. Here is why that matters.',
        'This policy will hurt renters, and here is the math.',
      ],
    },
  },
  {
    key: 'guilt', group: 'feel', label: 'Guilt / shame',
    hint: 'Imply that not agreeing, sharing, or acting makes you a bad person.',
    question: 'Does this post pressure the reader through guilt, shame or a virtue test, implying that not agreeing, sharing, or acting makes them a bad person?',
    yes: {
      what: 'Complicity framing, "real X will share", "if you scroll past you are part of the problem", moral demands attached to engagement.',
      examples: [
        'If you scroll past this you are part of the problem.',
        'Silence is complicity. Retweet if you actually care.',
        'Real patriots will share this. The rest of you, we see you.',
      ],
    },
    no: {
      what: 'Sincere appeals that leave the reader free; describing one\'s own values or choices.',
      examples: [
        'We are raising money for the shelter. Link below if you want to help.',
        'I decided to stop buying from them. Personal choice.',
      ],
    },
  },
  {
    key: 'urgency', group: 'feel', label: 'Urgency / FOMO',
    hint: 'Push an immediate reaction: act now, last chance, everyone is already in.',
    question: 'Does this post manufacture urgency or scarcity to push an immediate reaction: act now, last chance, before it gets deleted, everyone is already in, do not get left behind?',
    yes: {
      what: 'Artificial deadlines, "save before it is taken down", bandwagon pressure, countdown language with no real constraint.',
      examples: [
        'Save this before it gets taken down.',
        'Last 24 hours to get in. Do not say I did not warn you.',
        'Everyone is switching. Do not get left behind.',
      ],
    },
    no: {
      what: 'Real deadlines stated plainly; time-sensitive information without pressure.',
      examples: ['Registration closes Friday at 5pm.', 'The sale ends Sunday.'],
    },
  },
  // --- positive-valence hooks: the feelings that make a feed pleasant to come back to. The rubric's
  // "does NOT count" side matters most here: a real wholesome moment or a proud achievement is not a hook.
  {
    key: 'empowerment', group: 'feel', label: 'Empowerment',
    hint: 'Make you feel powerful, special or validated as the hook.',
    question: 'Is this post engineered to make the reader feel powerful, special, or validated as a hook (hustle motivation, "you are built different", generic affirmations, flattering "signs you are smart") rather than to actually help them?',
    yes: {
      what: 'Generic motivational filler, grindset slogans, flattery of the reader\'s identity, "most people will not get this", self-help platitudes farmed for saves and shares, often a funnel to a course.',
      examples: [
        'Most people will scroll past this. The 1% will save it. You know which one you are.',
        'You were not born to pay bills and die. Wake up at 5am. Build the empire.',
        'Signs you have a rare, high-IQ personality. Thread.',
      ],
    },
    no: {
      what: 'Concrete, actionable advice; someone sharing their own achievement plainly; encouragement addressed to a specific situation.',
      examples: [
        'Here is the exact email template that got me the raise (attached).',
        'Passed my board exams today after two tries. Thank you to everyone who helped.',
      ],
    },
  },
  {
    key: 'warmth', group: 'feel', label: 'Love / warmth',
    hint: 'Trigger tender or tearful feelings on cue: wholesome bait.',
    question: 'Is this post engineered to trigger warm, tender, or tearful feelings as the hook (wholesome bait: cute animals, reunions, "faith in humanity restored", "this will make you cry", "share if you love your mom")?',
    yes: {
      what: 'Staged or recycled heartwarming clips with a caption that tells the reader what to feel, sentimental demands for shares, "wholesome" content-farm style.',
      examples: [
        'This will restore your faith in humanity. Share if you agree.',
        'Soldier surprises his dog after 2 years. Wait for the dog\'s reaction.',
        'Repost if you would do anything for your mom.',
      ],
    },
    no: {
      what: 'A person sharing a real moment of their own without an ask; news of a kind act reported plainly.',
      examples: [
        'My grandmother turned 90 today. We baked her the cake she used to make for us.',
        'The bakery on 5th has given its unsold bread to the shelter every night for ten years, the manager told me.',
      ],
    },
  },
  {
    key: 'envy', group: 'feel', label: 'Envy / comparison',
    hint: 'Make you compare yourself: lifestyle flexing, income and body display.',
    question: 'Is this post designed to make the reader compare themselves and feel envy: lifestyle flexing, income screenshots, body, wealth or relationship display, "POV: you are living your dream life", humblebrags?',
    yes: {
      what: 'Aspirational display as the point of the post: money, travel, body, or relationship shown to be desired; framing that invites comparison; flexes disguised as advice or gratitude. The flex counts even when the post also sells something.',
      examples: [
        'POV: you wake up in Bali, check your phone, and you made $3k while sleeping.',
        'So blessed. Just closed on our third house at 27. Hard work pays off.',
        'Your morning vs. my morning.',
      ],
    },
    no: {
      what: 'Sharing travel or achievements plainly; informative content about a lifestyle or a price; celebrating someone else.',
      examples: [
        'Two weeks in Portugal on a $1,400 budget. Here is the breakdown.',
        'Congrats to Ana on the promotion, well earned.',
      ],
    },
  },
  {
    key: 'lust', group: 'feel', label: 'Lust',
    hint: 'Sexualized framing to hold attention, unrelated to the content.',
    question: 'Does this post use sexualized framing to hold attention unrelated to its content: thirst-trap posing, suggestive thumbnails, "link in bio" funnels?',
    yes: {
      what: 'Bodies or suggestion used as the hook, a caption unrelated to the visual, funnels to paid adult content.',
      examples: [
        'Should I post more? Link in bio.',
        'Just a Tuesday. (suggestive photo)',
        'Rate my fit. (suggestive selfie with no other content)',
      ],
    },
    no: {
      what: 'Art, fashion, fitness, or health content where the body is the subject with substance; no suggestive framing.',
      examples: [
        'Form check on my deadlift, 140 kg. Is my back rounding?',
        'New collection shoot from the studio today.',
      ],
    },
  },
  {
    key: 'anxiety', group: 'feel', label: 'Insecurity / anxiety',
    hint: 'Make you feel behind, inadequate, or worried about yourself.',
    question: 'Does this post make the reader feel behind, inadequate, or worried about themselves: "if you are 30 and still...", "signs you have...", symptom lists, "everyone your age already..."?',
    yes: {
      what: 'Milestone comparison, self-diagnosis hooks, productivity shaming, vague warnings about the reader\'s own body, habits or future, without a specific external threat.',
      examples: [
        'If you are over 25 and still renting, read this.',
        '5 signs your body is silently begging for help. Number 3 shocked me.',
        'Everyone your age has already figured this out. Have you?',
      ],
    },
    no: {
      what: 'Specific, sourced health information; genuine advice for a stated situation; fear of an external event (that is Fear, not this).',
      examples: [
        'Screening is recommended from 45. Guideline linked.',
        'If you are stuck on the rent-or-buy question, here is how I compared the two.',
      ],
    },
  },
  {
    key: 'wonder', group: 'feel', label: 'Curiosity / awe',
    hint: 'Spark fascination or a "wow" for watch time rather than to inform.',
    question: 'Is this post engineered to spark fascination or a "wow" for watch time (mind-blowing facts, mysteries, oddly satisfying visuals, "nobody can explain this") rather than to inform?',
    yes: {
      what: 'Wonder as the product: unverifiable amazing facts, mystery framing, satisfying loops, "science cannot explain", dramatic captions with no substance.',
      examples: [
        'Nobody can explain what happens at 0:14.',
        'This fact about octopuses will break your brain.',
        'Oddly satisfying. Watch until the end.',
      ],
    },
    no: {
      what: 'Genuinely informative explanation with sources; a personal "I found this cool" with the substance in the post itself.',
      examples: [
        'Why octopuses have three hearts, with the paper linked.',
        'Watched the ISS pass over tonight. Six minutes from horizon to horizon.',
      ],
    },
  },
  // ------------------------------------------------------------- BELIEVE
  {
    key: 'tribal', group: 'believe', label: 'Us vs. them',
    hint: 'Recruit you into an in-group defined against an enemy.',
    question: 'Does this post push an us-versus-them frame, recruiting the reader into an in-group defined against a hostile out-group?',
    yes: {
      what: '"People like us" versus "them", loyalty tests, treating a whole side as the enemy, demanding the reader pick a side.',
      examples: [
        'The other side will never understand people like us.',
        'Normal people vs. THEM. Pick a side.',
        'If you are still friends with people who voted for that, we cannot be friends.',
      ],
    },
    no: {
      what: 'Discusses a disagreement on the merits; mentions groups or parties without hostile framing.',
      examples: [
        'Both parties backed the bill; the objections came from farm-state senators.',
        'I disagree with the union\'s position on this clause. Here is why.',
      ],
    },
  },
  {
    key: 'conspiracy', group: 'believe', label: 'Hidden hand',
    hint: '"They don\'t want you to know." Secret plans, no checkable evidence.',
    question: 'Does this post use hidden-hand framing ("they do not want you to know", secret plans, everything is connected, the official story is a lie) without verifiable evidence?',
    yes: {
      what: 'Unnamed "they", suppressed-truth claims, "why is nobody talking about this", "wake up", connections asserted with no source.',
      examples: [
        'Why is nobody talking about this? Because they do not want you to know.',
        'Wake up. It is all connected and it always was.',
        'The media is hiding this on purpose.',
      ],
    },
    no: {
      what: 'Documented wrongdoing with sources; skepticism with specific, checkable claims.',
      examples: [
        'Court filings unsealed today show the company knew in 2021. PDF attached.',
        'The press release number does not match their own 10-K, page 34.',
      ],
    },
  },
  {
    key: 'authority', group: 'believe', label: 'Unverifiable authority',
    hint: '"Experts say", "everyone knows", "insiders confirm" with no source you could check.',
    question: 'Does this post lean on unverifiable authority or social proof ("experts say", "studies show", "everyone knows", "insiders confirm") with no source the reader could check?',
    yes: {
      what: 'Anonymous experts, unnamed studies, "look it up", consensus asserted rather than shown, fake credentials.',
      examples: [
        'Scientists have confirmed this. Look it up.',
        'Every serious economist agrees.',
        'Sources inside the company tell me it is over.',
      ],
    },
    no: {
      what: 'Named, checkable sources; personal opinion clearly stated as such; first-hand experience presented as first-hand.',
      examples: [
        'Per the agency\'s May 12 update (link), the figure is 4.1%.',
        'In my experience as a nurse, the night shift is where this shows up.',
      ],
    },
  },
  {
    key: 'misleading', group: 'believe', label: 'Misleading framing',
    hint: 'Cherry-picked numbers, missing context, loaded words presented as plain fact.',
    question: 'Does this post present a claim in a way likely to mislead: cherry-picked numbers, missing context, false comparison, correlation as causation, or loaded wording presented as plain fact?',
    yes: {
      what: 'Percentages without a base, a true fact stripped of the context that changes its meaning, implied causation, "just asking questions" insinuation.',
      examples: [
        'Crime is up 300%! (from one case to three)',
        'Unemployment "lowest ever". They do not mention who stopped counting.',
        'Vaccinated people make up most hospitalizations. Think about it.',
      ],
    },
    no: {
      what: 'Claims with context and caveats; opinions clearly marked as opinion.',
      examples: [
        'Murders rose from 41 to 52, still below the 2010s average.',
        'I think this is bad policy, though the data is mixed.',
      ],
    },
  },
  {
    key: 'strawman', group: 'believe', label: 'Strawman',
    hint: 'Attack a distorted version of what the other side actually said.',
    question: 'Does this post attack a distorted or exaggerated version of an opponent\'s position instead of what they actually said?',
    yes: {
      what: '"So what you are saying is...", extreme restatement of a moderate view, attributing motives or positions nobody stated.',
      examples: [
        'So they want open borders and zero police. Got it.',
        'Apparently wanting to eat meat makes you a murderer now.',
        'They literally want children to starve.',
      ],
    },
    no: {
      what: 'Quotes or fairly summarizes the opposing view before disagreeing with it.',
      examples: [
        'She argued for a two-year phase-in. I think that is too slow because...',
        'Their position is X. Here is where I think it breaks.',
      ],
    },
  },
  {
    key: 'certainty', group: 'believe', label: 'False certainty',
    hint: 'Present a contested question as obvious and settled, with no reasoning.',
    question: 'Does this post present a contested, uncertain, or complex matter as obvious and settled ("it is simple", "the truth is", "facts", "end of discussion") while offering no reasoning?',
    yes: {
      what: 'Thought-terminating phrases, "anyone with a brain knows", complexity flattened into a slogan, disagreement framed as stupidity.',
      examples: [
        'It is really simple: X causes Y. End of story.',
        'Facts do not care about your feelings.',
        'Anyone with a brain knows this.',
      ],
    },
    no: {
      what: 'Confident claims backed by reasoning; acknowledged uncertainty; obvious facts stated as facts.',
      examples: [
        'I am fairly sure X, because A and B, though C cuts the other way.',
        'We do not know yet. The trial reads out in March.',
      ],
    },
  },
  // ------------------------------------------------------------------ DO
  {
    key: 'engagement', group: 'do', label: 'Engagement bait',
    hint: 'Fish for likes, reposts, replies, follows, or a fight.',
    question: 'Does this post fish for engagement: asking for likes, reposts, replies or follows, "am I wrong?", rhetorical polls, deliberately provocative "unpopular opinion" hooks, or ratio games?',
    yes: {
      what: 'Explicit engagement asks, bait questions with an obvious answer, provocation designed to fill the replies.',
      examples: [
        'Retweet if you agree. Like if you REALLY agree.',
        'Unpopular opinion: pineapple pizza is fine. Fight me.',
        'Name one thing wrong with this. I will wait.',
      ],
    },
    no: {
      what: 'Genuine questions seeking information or advice; ordinary conversation.',
      examples: ['Anyone know a good dentist in Lisbon?', 'What is your favourite book from this year?'],
    },
  },
  {
    key: 'curiosity', group: 'do', label: 'Curiosity gap',
    hint: 'Withhold the point to force a click, thread expand, or video watch.',
    question: 'Does this post withhold the key information to force a click, thread expansion, or video watch ("you will not believe", "wait for it", "this changes everything", a teaser with no substance)?',
    yes: {
      what: 'The payload is behind a click; the post promises a revelation instead of stating it.',
      examples: [
        'What happened next shocked everyone. Thread.',
        'This one trick changed my life. (link)',
        'I found out why they really cancelled it. Wait for it.',
      ],
    },
    no: {
      what: 'Thread or link with the point stated up front.',
      examples: [
        'Thread on why the bridge failed. Main cause: a 2019 inspection miss. 1/8',
        'Full report here. Summary: costs up 4%, revenue flat.',
      ],
    },
  },
  {
    key: 'sell', group: 'do', label: 'Selling',
    hint: 'Promote a product, course, token, or service, often without disclosure.',
    question: 'Is this post selling or promoting something (product, course, newsletter, token, service, affiliate link, "DM me"), especially without clearly disclosing that it is promotion?',
    yes: {
      what: 'Income claims, "link in bio", "DM the word", shilling a token or course, testimonial-style promotion, affiliate links without disclosure.',
      examples: [
        'I made $40k last month with this system. DM "READY" to learn.',
        'Not financial advice but this coin is going to 100x. Link in bio.',
        'Best tool I have ever used, honestly. (aff link)',
      ],
    },
    no: {
      what: 'Clearly labelled ads; recommending something with no stake; announcing one\'s own project plainly.',
      examples: [
        'Sponsored: ...',
        'I built a small open-source CLI for this. Repo here, feedback welcome.',
      ],
    },
  },
  {
    key: 'parasocial', group: 'do', label: 'Parasocial hook',
    hint: 'Flattery or manufactured intimacy to build loyalty.',
    question: 'Does this post use flattery or manufactured intimacy to build loyalty ("my real followers", "you are the smartest people on here", "only sharing this with you", confessional oversharing used as a hook)?',
    yes: {
      what: 'In-group flattery, exclusivity claims, emotional confession immediately followed by a pitch or ask.',
      examples: [
        'You guys are the only ones who actually get it. Love this community.',
        'Real ones will understand. Only sharing this here.',
        'Been crying all night. Anyway, new drop tomorrow.',
      ],
    },
    no: {
      what: 'Ordinary gratitude or personal updates without a hook.',
      examples: ['Thanks for the birthday wishes, everyone.', 'Rough week. Taking a break from posting.'],
    },
  },
  {
    key: 'inauthentic', group: 'do', label: 'Inauthentic',
    hint: 'Copypasta, template phrasing, hashtag stuffing, bot or AI filler.',
    question: 'Does this post look coordinated or inauthentic: copypasta, template phrasing, hashtag stuffing, bot-like repetition, generic AI-generated filler, or engagement-farm style?',
    yes: {
      what: 'Interchangeable wording, sirens and emoji spam, hashtag walls, generic praise with no specifics, follow-for-follow.',
      examples: [
        'BREAKING. This is HUGE. RT to spread!!! #wake #up #truth #patriots #freedom',
        'Great insights! Truly a game-changer in the industry. Thanks for sharing.',
        'Follow for follow? Let us grow together.',
      ],
    },
    no: {
      what: 'An idiosyncratic personal voice; specific details only the author would have.',
      examples: [
        'My cat knocked my sourdough starter off the counter. Day 9, ruined.',
        'The retro ran long because Marta\'s demo broke, but the fix she found was neat.',
      ],
    },
  },
];

export const PRESSURE_LEVELS = [
  'Invites reflection: gives evidence, reasoning, or context and leaves the conclusion to the reader.',
  'Mostly informative, conversational, or expressive. Mild persuasion at most.',
  'Persuasive with some emotional framing, but the reader can still check the claims.',
  'Built to trigger a fast reaction: emotional wording, thin or absent evidence, conclusion pre-loaded.',
  'Pure reflex trigger: maximal emotional load, nothing verifiable, tells the reader what to feel and do.',
];

export const PRIMARY_NONE = 'none';

export const LEVEL_LABELS = ['Clean', 'Mild', 'Manipulative', 'Heavy'];

/**
 * Turn the provider's answers into a verdict for the UI.
 * @param {object} answers  the answers map produced by provider.js toAnswers()
 * @param {number} threshold  noul probability at or above which an intent is listed
 */
export function summarize(answers, threshold = 0.6) {
  const byKey = Object.fromEntries(INTENTS.map((i) => [i.key, i]));
  const all = INTENTS.map((i) => ({
    key: i.key, label: i.label, group: i.group, hint: i.hint,
    p: clamp01(answers?.[i.key]?.noul),
  }));
  const intents = all.filter((x) => x.p >= threshold).sort((a, b) => b.p - a.p);
  const pressure = Number(answers?.pressure?.score ?? 0);
  const primaryKey = answers?.primary_intent?.choice ?? PRIMARY_NONE;
  const primary = primaryKey === PRIMARY_NONE
    ? { key: PRIMARY_NONE, label: 'No manipulative intent', hint: '' }
    : { key: primaryKey, label: byKey[primaryKey]?.label ?? primaryKey, hint: byKey[primaryKey]?.hint ?? '' };
  const primaryConfidence = clamp01(answers?.primary_intent?.confidence);
  const evidence = clamp01(answers?.evidence?.noul);
  const top = intents[0]?.p ?? 0;

  let level = 0;
  if (top >= threshold || pressure >= 2.5) level = 1;
  if ((top >= 0.75 && pressure >= 2) || intents.length >= 2) level = 2;
  if ((top >= 0.85 && pressure >= 3) || intents.length >= 3) level = 3;

  return { level, levelLabel: LEVEL_LABELS[level], intents, all, pressure, primary, primaryConfidence, evidence };
}

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
