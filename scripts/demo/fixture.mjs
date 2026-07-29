// Shared demo vault — one plausible, neutral set of notes used by BOTH the
// screenshot generator (shots.mjs) and the video recorder (record.mjs), so the
// two never drift apart. Never real client names.
//
// Notes are stored as HTML inside .md files — that is Noted's on-disk format —
// so each fixture is written exactly as the editor would have saved it.

// TipTap's task-list serialisation. Hand-written so the fixture matches what
// the editor itself produces.
export const taskList = items => `<ul data-type="taskList">${items.map(([text, done]) =>
  `<li data-type="taskItem" data-checked="${done}"><label><input type="checkbox"${done ? ' checked' : ''}><span></span></label><div><p>${text}</p></div></li>`,
).join('')}</ul>`;

// Ordered oldest first; the sidebar sorts by mtime, so the last one written
// lands on top. Wikilinks point at real notes in this set, so backlinks and
// click-through navigation both work in the demo.
export const NOTES = [
  ['Meeting — vendor review.md', `<h1>Meeting — vendor review</h1><p>Three renewals land in the same quarter, which is the actual problem — not the pricing.</p><ul><li><p>Storage contract auto-renews on the 12th</p></li><li><p>Ask for the volume tier before, not after</p></li></ul>`],
  ['Reading list.md', `<h1>Reading list</h1><ul><li><p>Designing Data-Intensive Applications — ch. 5 onwards</p></li><li><p>A Philosophy of Software Design</p></li><li><p>The Grammar of Graphics</p></li></ul><p>See also <a href="#" data-type="wikilink">Aurora — Q3 notes</a>.</p>`],
  ['Onboarding — first week.md', `<h1>Onboarding — first week</h1><p>Everything a new engineer needs before they touch the deploy pipeline.</p><ol><li><p>Local build green</p></li><li><p>Read the incident log for the last quarter</p></li></ol>`],
  ['Interview notes — platform.md', `<h1>Interview notes — platform</h1><p>Strong on systems, thin on testing. Worth a second conversation with the infra pair.</p>`],
  ['Aurora — Q3 notes.md', `<h1>Aurora — Q3 notes</h1><p>Weekly sync — metrics up, onboarding polish is next.</p><p>Retention held through the migration, so the risk we sized in June never landed. The remaining work is presentation, not plumbing.</p><p>Ship checklist lives in <a href="#" data-type="wikilink">Aurora — launch plan</a>.</p>`],
  ['Aurora — launch plan.md', `<h1>Aurora — launch plan</h1><p>Beta ships Friday. Everything below has to be true before we tag it.</p>${taskList([
    ['Changelog written and proofread', true],
    ['Release notes drafted for the blog', true],
    ['Notarized build verified on a clean machine', false],
    ['Rollback tested end to end', false],
  ])}<h2>Open questions</h2><p>Do we hold the announcement until the docs site redeploys? Leaning yes — a launch post that links to a 404 costs more than a day of waiting.</p><p>Context in <a href="#" data-type="wikilink">Aurora — Q3 notes</a>.</p><h2>After the tag</h2><p>Watch the crash rate for 48 hours before promoting it anywhere with a real audience.</p>`],
];

// Write the fixture into a vault directory, oldest first with distinct mtimes
// so the "recently modified" order is stable rather than dependent on loop
// speed. Self-contained so both the screenshot and video harnesses call the
// exact same seeding — one source of truth for what the demo vault contains.
export async function seedVault(vaultDir) {
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (const [name, html] of NOTES) {
    writeFileSync(join(vaultDir, name), html, 'utf-8');
    await sleep(15);
  }
}
