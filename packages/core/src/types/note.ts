export const NOTE_VISIBILITIES = ['private', 'shared', 'public'] as const;
export type NoteVisibility = (typeof NOTE_VISIBILITIES)[number];

export const NOTE_RELATIONS = [
  'relates_to',
  'blocks',
  'blocked_by',
  'duplicates',
  'parent',
  'child',
] as const;
export type NoteRelation = (typeof NOTE_RELATIONS)[number];

/**
 * Note entity (note table).
 */
export interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  folder?: string;
  pinned: boolean;
  visibility: NoteVisibility;
  createdAt: string;
  updatedAt: string;
}

/**
 * Directed link between two notes (note_link table).
 */
export interface NoteLink {
  id: string;
  sourceNoteId: string;
  targetNoteId: string;
  relation: NoteRelation;
  label?: string;
  createdAt: string;
}
