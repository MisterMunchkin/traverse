import {Button, Text} from '@expo/ui';
import {router} from 'expo-router';
import {Page} from '@/components/page';
import {useNote} from '@/components/note-store';

export default function Detail() {
  const {note} = useNote();
  return <Page title="Garden walk">
    <Text>{note || '(Empty note)'}</Text>
    <Button onPress={() => router.push('/notes/edit')}>Edit note</Button>
    <Button variant="outlined" onPress={() => router.replace('/notes')}>All notes</Button>
  </Page>;
}
