import {Stack} from 'expo-router/stack';
import {NoteProvider} from '@/components/note-store';

export default function Layout() {
  return <NoteProvider><Stack screenOptions={{headerShown: false}} /></NoteProvider>;
}
