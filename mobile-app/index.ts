import { registerRootComponent } from 'expo';

// Side-effect import: registers the periodic photo-backup TaskManager task in
// both the foreground and the OS-spawned headless JS runtime. Must run at
// bundle load, before the OS may invoke the task.
import './src/services/photoBackupTask';

import App from './App';

registerRootComponent(App);
