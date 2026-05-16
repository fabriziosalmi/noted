export interface NoteTemplate {
  id: string;
  name: string;
  icon: string;
  content: string; // HTML
}

export const BUILTIN_TEMPLATES: NoteTemplate[] = [
  {
    id: 'meeting',
    name: 'Riunione',
    icon: '🤝',
    content: `<h1>Riunione</h1><p><strong>Data:</strong> ${new Date().toLocaleDateString('it-IT')}</p><p><strong>Partecipanti:</strong> </p><h2>Agenda</h2><ul><li><p></p></li></ul><h2>Note</h2><p></p><h2>Decisioni</h2><ul><li><p></p></li></ul><h2>Action items</h2><ul><li><p></p></li></ul>`,
  },
  {
    id: 'project',
    name: 'Progetto',
    icon: '🚀',
    content: `<h1>Progetto</h1><h2>Obiettivo</h2><p></p><h2>Scope</h2><ul><li><p></p></li></ul><h2>Milestones</h2><ul><li><p></p></li></ul><h2>Risorse</h2><p></p><h2>Note</h2><p></p>`,
  },
  {
    id: 'research',
    name: 'Ricerca',
    icon: '🔬',
    content: `<h1>Ricerca</h1><h2>Domanda</h2><p></p><h2>Fonti</h2><ul><li><p></p></li></ul><h2>Sintesi</h2><p></p><h2>Conclusioni</h2><p></p><h2>Riferimenti</h2><p></p>`,
  },
  {
    id: 'journal',
    name: 'Diario',
    icon: '📓',
    content: `<h1>${new Date().toLocaleDateString('it-IT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</h1><h2>Come mi sento</h2><p></p><h2>Cosa è successo</h2><p></p><h2>Gratitudine</h2><ul><li><p></p></li></ul><h2>Domani</h2><p></p>`,
  },
  {
    id: 'brainstorm',
    name: 'Brainstorm',
    icon: '💡',
    content: `<h1>Brainstorm</h1><h2>Tema</h2><p></p><h2>Idee libere</h2><ul><li><p></p></li></ul><h2>Idee migliori</h2><ul><li><p></p></li></ul><h2>Prossimi passi</h2><ul><li><p></p></li></ul>`,
  },
];
