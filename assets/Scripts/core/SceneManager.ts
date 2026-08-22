import { director } from 'cc';

export class SceneManager {

    public loadScene(sceneName: string): void {
        director.loadScene(sceneName);
    }

}

export const sceneManager = new SceneManager();
