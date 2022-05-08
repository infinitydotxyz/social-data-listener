import { AccessLevel } from './config';
import { Twitter } from './twitter';
import { dbMock } from '../../test/mocks';

test('should convert Twitter URL to handle', () => {
  const url = 'https://www.twitter.com/sleeyax';
  const expected = 'sleeyax';
  expect(Twitter.extractHandle(url)).toBe(expected);
  expect(Twitter.extractHandle(url + '/')).toBe(expected);
  expect(Twitter.extractHandle(url + '///')).toBe(expected);
  expect(Twitter.extractHandle('sleeyax')).toBe(expected);
  expect(Twitter.extractHandle('@sleeyax')).toBe(expected);
});

test('should convert handle to URL', () => {
  const handle = 'sleeyax';
  const expected = 'https://twitter.com/sleeyax';
  expect(Twitter.appendHandle(handle)).toBe(expected);
});

test('should build stream rules from twitter accounts', () => {
  const twitter = new Twitter({ bearerToken: 'test' }, dbMock);
  let accounts = [
    'goatlodge',
    'BattleVerse_io',
    'chromorphs',
    'bullsontheblock',
    'JohnOrionYoung',
    'the_n_project_',
    'superplastic',
    'PixlsOfficial',
    'LuckyManekiNFT',
    'TheProjectURS',
    'robotosNFT',
    'satoshibles',
    'SaconiGen',
    'FatalesNFT',
    '10KTFShop',
    'nahfungiblebone',
    'lostsoulsnft',
    'DropBearsio',
    'cryptoadzNFT',
    'MekaVerse',
    'boredapeyc',
    'pudgy_penguins',
    'worldofwomennft'
  ];
  let rules = twitter.buildStreamRules(accounts, AccessLevel.Essential, '');
  expect(rules.add.length).toBe(1);
  expect(rules.add[0].value).toBe(
    '(from:goatlodge OR from:BattleVerse_io OR from:chromorphs OR from:bullsontheblock OR from:JohnOrionYoung OR from:the_n_project_ OR from:superplastic OR from:PixlsOfficial OR from:LuckyManekiNFT OR from:TheProjectURS OR from:robotosNFT OR from:satoshibles OR from:SaconiGen OR from:FatalesNFT OR from:10KTFShop OR from:nahfungiblebone OR from:lostsoulsnft OR from:DropBearsio OR from:cryptoadzNFT OR from:MekaVerse OR from:boredapeyc OR from:pudgy_penguins OR from:worldofwomennft)'
  );

  // push some more data in order to exceed length limit
  accounts.push('sleeyax');
  accounts.push('jfrazier');
  accounts.push('elonmusk');

  rules = twitter.buildStreamRules(accounts, AccessLevel.Essential, '');

  expect(rules.add.length).toBe(2);
  expect(rules.add[0].value.endsWith('sleeyax)')).toBe(true);
  expect(rules.add[1].value).toBe('(from:jfrazier OR from:elonmusk)');
});
