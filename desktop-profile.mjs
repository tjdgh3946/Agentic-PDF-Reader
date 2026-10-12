import {mkdirSync} from 'node:fs';
import path from 'node:path';

export function configureDesktopProfile(app){
  const override=app.commandLine.getSwitchValue('user-data-dir');
  const directory=override?path.resolve(override):path.join(app.getPath('appData'),'Paper Reader');
  mkdirSync(directory,{recursive:true});
  app.setPath('userData',directory);
  app.setPath('sessionData',directory);
  return directory;
}
