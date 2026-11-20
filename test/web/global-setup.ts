import { generateFixtures, generateHumFixtures, generateTeachFixtures, generateTeachPageSeed } from './fixture';

// Runs once before the browser tests. It writes the fixtures into the ignored folder and fails the run if the
// Node engine does not recognise them.
export default async function globalSetup(): Promise<void> {
  await generateFixtures();
  await generateTeachFixtures();
  await generateTeachPageSeed();
  await generateHumFixtures();
}
