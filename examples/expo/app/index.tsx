import {Button, Text} from '@expo/ui';
import {router} from 'expo-router';
import {Page} from '@/components/page';

export default function Home() {
  return <Page title="A small place to explore">
    <Text>Open a field note, change its text, then save or cancel. Everything stays in this session.</Text>
    <Button onPress={() => router.push('/notes')}>Browse notes</Button>
    <Text>Synthetic data. No account or network connection needed.</Text>
  </Page>;
}
