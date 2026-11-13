export interface UserNote {
  id: string;
  owner_id: string;
  title: string;
  content: string;
  tags: string[];
  is_starred: boolean;
  is_character_note?: boolean;
  character_id?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateNotePayload {
  title?: string;
  content: string;
  tags?: string[];
  is_starred?: boolean;
}

export interface UpdateNotePayload {
  title?: string;
  content?: string;
  tags?: string[];
  is_starred?: boolean;
}
