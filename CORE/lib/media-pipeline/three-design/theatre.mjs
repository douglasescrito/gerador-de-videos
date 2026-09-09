import { getProject, createRafDriver, onChange } from '@theatre/core';

// Exported Studio state is input data; the editor never enters production bundles.
export function createTheatreTrack({ id, state, sheetName, objectName, properties, apply }) {
  if (!state || typeof state !== 'object') throw Error('Theatre exige state exportado.');
  const driver = createRafDriver({ name: 'Studio explicit frame' });
  const project = getProject(id, { state });
  const sheet = project.sheet(sheetName), object = sheet.object(objectName, properties);
  const unsubscribe = onChange(object.props, apply, driver);
  return { ready: project.ready, seek(seconds) { sheet.sequence.pause(); sheet.sequence.position = seconds; driver.tick(seconds * 1000); apply(object.value); }, dispose: unsubscribe };
}
