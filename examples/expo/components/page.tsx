import {Column, Host, Text} from '@expo/ui';
import type {PropsWithChildren} from 'react';
import {ScrollView} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

export function Page({title, children}: PropsWithChildren<{title: string}>) {
  return (
    <SafeAreaView style={{flex: 1, backgroundColor: '#f6f7f4'}}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding: 24}}>
        <Host matchContents colorScheme="light" seedColor="#285c42">
          <Column spacing={20} style={{padding: 12}}>
            <Text textStyle={{fontSize: 14, color: '#52645a'}}>WAYFINDER · FIELD NOTES</Text>
            <Text textStyle={{fontSize: 30, fontWeight: 'bold'}}>{title}</Text>
            {children}
          </Column>
        </Host>
      </ScrollView>
    </SafeAreaView>
  );
}
