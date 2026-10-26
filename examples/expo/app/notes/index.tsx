import {Button, Text} from '@expo/ui';
import {router} from 'expo-router';
import {Page} from '@/components/page';
import {useNote} from '@/components/note-store';

export default function Notes() {
  const {note} = useNote();
  return <Page title="Your notes">
    <Text textStyle={{fontWeight: 'bold'}}>Garden walk</Text>
    <Text>{note || '(Empty note)'}</Text>
    <Button onPress={() => router.push('/notes/first')}>Open Garden walk</Button>
    <Button variant="outlined" onPress={() => router.replace('/')}>Home</Button>
  </Page>;
}
