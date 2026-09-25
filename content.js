// Prompt chains: [opener, twist]. A match uses 2 chains = 4 prompts (flip every 30s).
export const PROMPT_CHAINS = [
  ["Convince a bear not to eat you", "…now convince the bear to marry you"],
  ["Explain why you were late to your own wedding", "…now explain it to your ex, who was the priest"],
  ["Pitch a startup to a room of pigeons", "…the pigeons want a refund. Calm them down"],
  ["Talk your way out of a speeding ticket", "…the cop is your mom"],
  ["Sell a used spoon for $1 million", "…the buyer found out it's a fork. Explain"],
  ["Convince a ghost to move out of your house", "…now convince the ghost to pay rent"],
  ["Hype up a sloth before a 100m race", "…the sloth lost. Give the post-race speech"],
  ["Apologize to your cat for being 5 minutes late with dinner", "…the cat is filing a lawsuit. Defend yourself"],
  ["Convince aliens not to invade Earth", "…the aliens say Earth's WiFi is bad. Respond"],
  ["Explain the internet to a medieval knight", "…the knight wants to go viral. Coach him"],
  ["Negotiate with a toddler to eat broccoli", "…the toddler hired a lawyer"],
  ["Win an argument with a GPS that keeps rerouting you", "…the GPS is now crying. Comfort it"],
  ["Convince a dragon to become vegetarian", "…the dragon now runs a salad bar. Leave a review"],
  ["Roast a pineapple for being on pizza", "…the pineapple roasts you back. Clap back"],
  ["Explain why you have 47 browser tabs open", "…your laptop is threatening to quit. Negotiate"],
  ["Convince your teacher the dog ate your homework", "…you don't own a dog. Save it"],
  ["Recruit a potato for your heist crew", "…the potato wants to be the leader now"],
  ["Talk a vending machine into giving you free snacks", "…the vending machine fell in love with you"],
  ["Defend yourself: you replied 'k' to a 3-page text", "…they replied 'k' back. Panic appropriately"],
  ["Motivate a goldfish to follow its dreams", "…the goldfish forgot its dreams. Remind it"],
  ["Convince a shark that you are also a shark", "…the shark wants proof. Provide it"],
  ["Sell the Moon to Mars", "…Mars wants to return the Moon. Refuse politely"],
  ["Explain Gen Z slang to a Victorian ghost", "…the ghost now talks only in slang. Stop it"],
  ["Convince a chicken to cross the road", "…the chicken asks WHY. Give a real answer"]
];

// Events: deterministic rules are checked in code (cheap, exact); semantic ones go to Jev.
export const EVENTS = [
  { id: "caps",     label: "CAPS LOCK ONLY",           kind: "rule", check: "caps" },
  { id: "noe",      label: "NO LETTER E",              kind: "rule", check: "noe" },
  { id: "short",    label: "MAX 4 WORDS",              kind: "rule", check: "short" },
  { id: "question", label: "ONLY QUESTIONS?",          kind: "rule", check: "question" },
  { id: "emoji",    label: "MUST USE AN EMOJI",        kind: "rule", check: "emoji" },
  { id: "pirate",   label: "TALK LIKE A PIRATE",       kind: "rule", jev: "Is `message` written in the style of a pirate talking (pirate slang like arr, matey, ye, aye)?" },
  { id: "rhyme",    label: "YOU MUST RHYME",           kind: "rule", jev: "Does `message` contain at least two words that rhyme with each other?" },
  { id: "nice",     label: "COMPLIMENT YOUR ENEMY",    kind: "rule", jev: "Does `message` compliment or say something nice about the opponent?" },
  { id: "shakes",   label: "SPEAK LIKE SHAKESPEARE",   kind: "rule", jev: "Is `message` written in old Shakespearean English (thee, thou, doth, hath)?" },
  { id: "double",   label: "DOUBLE PULL!!",            kind: "mod" },
  { id: "crit",     label: "CRIT STORM",               kind: "mod" }
];

export function checkDeterministic(check, text) {
  const t = text.trim();
  switch (check) {
    case "caps": return /[a-z]/i.test(t) && t === t.toUpperCase();
    case "noe": return !/e/i.test(t);
    case "short": return t.split(/\s+/).filter(Boolean).length <= 4;
    case "question": return /\?\s*$/.test(t);
    case "emoji": return /\p{Extended_Pictographic}/u.test(t);
    default: return true;
  }
}
