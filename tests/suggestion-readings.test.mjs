import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../request/categories.mjs';
import { artistSearchNames, songSearchNames } from '../request/suggestion-readings.mjs';

test('歌手と曲の読みで検索でき、同名の別歌手の曲に読みを流用しない', () => {
 const entry = {artist:'星野源', song:'恋'};
 assert(artistSearchNames(entry).some(name => normalize(name) === normalize('ホシノゲン')));
 assert(songSearchNames(entry).includes('こい'));
 assert(!songSearchNames({...entry, artist:'別の歌手'}).includes('こい'));
 assert(songSearchNames({artist:'山下智久', song:'Loveless', aliases:['らぶれす']}).includes('らぶれす'));
});
