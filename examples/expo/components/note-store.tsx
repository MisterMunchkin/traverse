import {createContext, useContext, useState, type PropsWithChildren} from 'react';

const Notes = createContext<{note: string; save: (text: string) => void} | null>(null);
export function NoteProvider({children}: PropsWithChildren) {
  const [note, save] = useState('Bring a notebook on the garden walk.');
  return <Notes.Provider value={{note, save}}>{children}</Notes.Provider>;
}
export function useNote() {
  const state = useContext(Notes);
  if (!state) throw new Error('NoteProvider is required');
  return state;
}
