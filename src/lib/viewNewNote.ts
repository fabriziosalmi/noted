import { useStore } from '../store/useStore';
import { translate } from './i18n';
import { prependFrontmatterComment } from '../../shared/markdown/frontmatter';
import { seedBlock, seedFor } from '../../shared/views/seed';
import type { View } from '../../shared/views/model';
import type { FieldType } from '../../shared/views/schema';

/**
 * Make a note from inside a view and open it: in the view's folder, with its tag, and with the properties that make it
 * belong to the view (a board column's value, an "is" filter's value). The title is left empty for the user to type; the
 * file is named after it as for any new note.
 */
export async function createNoteInView(view: View, typeOf: (field: string) => FieldType, column?: string | null): Promise<void> {
  const store = useStore.getState();
  const seed = seedFor(view, typeOf, column);
  const prefix = translate('newNoteFilePrefix', store.settings.language);
  const name = `${seed.folder ? `${seed.folder}/` : ''}${prefix}_${Date.now()}.md`;
  const html = `<h1></h1><p>${seed.tag ? `${seed.tag} ` : ''}</p>`;
  await store.createNote(name, prependFrontmatterComment(html, seedBlock(seed.fields)));
}
