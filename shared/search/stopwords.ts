// Words too common to say anything about what a question is after: used to judge whether a section really shares something
// with the question (a query for "what is the capital of France" matches every note by "the" and "is"). Function words of the
// languages the app is translated into; not exhaustive, and a word missing here only makes a judgement a little more generous.

const WORDS = `
a about after all also an and any are as at be been but by can could did do does for from had has have he her his how i if in into is it its
may me more most my no not now of on one or our out over she so some than that the their them then there these they this to too up us was we
were what when where which who why will with would you your
al alla alle anche che chi ci come con cosa così cui da dal dei del della delle dello di dove e ed gli ha hanno ho i il in io la le lei lo loro lui ma
mi ne nei nel nella non o per perché più quale quali quando quanto questa queste questi questo se si sono su sul sulla sua sue suo tra tu tutti un una uno
a al como con cual cuando de del el ella en es esta este la las lo los más mi no para pero por que qué se si su sus un una y
à au aux avec ce ces dans de des du elle en est et il je la le les mais ne nous ou par pas pour que qui sur un une vous
aber auch auf aus bei das dem den der des die ein eine einen einer es für ich ist mit nicht oder sich sie und von wie wir zu
às com da das do dos em é essa esse eu mas na nas no nos não o os para por que se um uma
`.split(/\s+/).filter(Boolean);

export const STOPWORDS: ReadonlySet<string> = new Set(WORDS);
