import {Button, Text, TextInput, useNativeState} from '@expo/ui';
import {router} from 'expo-router';
import {Page} from '@/components/page';
import {useNote} from '@/components/note-store';

export default function Edit() {
  const {note, save} = useNote();
  const draft = useNativeState(note);
  return <Page title="Edit Garden walk">
    <Text>Note text</Text>
    <TextInput value={draft} multiline numberOfLines={4} maxLength={500}
      testID="note-draft" placeholder="Write a field note" style={{padding: 12, borderWidth: 1, borderColor: '#52645a', borderRadius: 8}} />
    <Button onPress={() => { save(draft.value); router.replace('/notes/first'); }}>Save</Button>
    <Button variant="outlined" onPress={() => router.replace('/notes/first')}>Cancel</Button>
    <Text>Save changes this session. Cancel discards this draft. Reload resets the sample.</Text>
  </Page>;
}
