import { generateFixtures, generateHumFixtures, generateTeachFixtures, generateTeachPageSeed } from './fixture';
import { generateShooFixture } from './shoo-fixture';
import { generateTalkFixture } from './click-talk-fixture';
import { generateSlidesFixture } from './slides-fixture';
import { generateSiteFixture } from './site-fixture';

// Runs once before the browser tests. It writes the fixtures into the ignored folder and fails the run if the
// Node engine does not recognise them.
export default async function globalSetup(): Promise<void> {
  await generateFixtures();
  await generateTeachFixtures();
  await generateTeachPageSeed();
  await generateHumFixtures();
  await generateSlidesFixture();      // Task 26
  await generateShooFixture();        // Task 33
  await generateTalkFixture();        // Task 34
  await generateSiteFixture();        // Task 35
}
