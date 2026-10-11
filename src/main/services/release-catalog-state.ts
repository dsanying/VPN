import * as path from 'node:path';
import { ReleaseCatalogState } from '../../shared/release-catalog-state';
import { getUserDataPath } from '../utils/paths';
import { privateDocumentStore } from './private-document-store';

const states = new Map<string, ReleaseCatalogState>();
export function desktopReleaseCatalogState(): ReleaseCatalogState {
  const file = path.join(getUserDataPath(), 'release-catalog-trust.json');
  let state = states.get(file);
  if (!state) {
    state = new ReleaseCatalogState(privateDocumentStore());
    states.set(file, state);
  }
  return state;
}
