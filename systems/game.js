import * as THREE from 'three';
import { scene } from '../scene.js';
import { createBear, updateBear } from '../entities/bear.js';
import { createFish, updateFish } from '../entities/fish.js';
import { initAudio, playSFX, sounds, wireAudioUnlock } from './audio.js';
import { bindUI, updateUIValues, showGameOver, showHUD, showStart, populateUnlocks } from './ui.js';
import { BEARS, FISH, getPlayerProgress, savePlayerProgress } from '../unlocks.js';
import { updateSpawner, resetSpawner } from './fishSpawner.js';

// --- GAME OBJECTS ---
export let bear = null;
let showcaseBear = null;
let showcaseFish = null;
let activeFishes = [];

// --- UI & STATE ---
const { startButton } = bindUI();
let playerProgress = getPlayerProgress();
export let gameState = { current: 'IDLE', score: 0, streak: 1, idleAnimTimer: 0 };
const gravity = new THREE.Vector3(0, -0.05, 0);
let isFirstLoad = true;

/**
 * [FIX] Technical Note: The 'missing arm' bug on retry was due to improper
 * disposal of THREE.js objects. Simply removing an object from the scene
 * doesn't free up its geometry and material data from GPU memory. This
 * function ensures a deep disposal of an object and all its children.
 * It's called on the old `showcaseBear` before creating a new one to prevent
 * state corruption and rendering glitches.
 */
function disposeObject(obj) {
    if (!obj) return;

    // Dispose of children first
    while (obj.children.length > 0) {
        disposeObject(obj.children[0]);
        obj.remove(obj.children[0]);
    }

    // Dispose of the object itself
    if (obj.isMesh) {
        if (obj.geometry) {
            obj.geometry.dispose();
        }
        // [FIX] DO NOT dispose materials. They are shared constants across
        // different bear/fish instances. Disposing them globally breaks
        // any future objects that try to use them. Geometries are created
        // uniquely per part, so they are safe to dispose.
        /* if (obj.material) {
            if (Array.isArray(obj.material)) {
                obj.material.forEach(material => material.dispose());
            } else {
                obj.material.dispose();
            }
        } */
    }
}

function createOrUpdateShowcase() {
    // Only recreate if bear type changed or doesn't exist
    const needsNewBear = !showcaseBear || 
        showcaseBear.userData.bearType !== playerProgress.selectedBear;
    
    if (needsNewBear) {
        // [FIX] Perform a full, robust disposal of the old showcase objects.
        if (showcaseBear) {
            disposeObject(showcaseBear);
            scene.remove(showcaseBear);
            showcaseBear = null;
            showcaseFish = null;
        }

        // Create the bear and fish from a clean slate.
        showcaseBear = createBear(playerProgress.selectedBear);
        showcaseBear.name = 'showcase-bear';
        showcaseBear.userData.isShowcase = true;
        showcaseBear.userData.bearType = playerProgress.selectedBear; // Track bear type
        showcaseBear.position.set(0, 4.65, 0.8);
        showcaseBear.rotation.set(0, 0, 0);
        scene.add(showcaseBear);
    }

    // Always recreate fish if needed (it's lightweight)
    const needsNewFish = !showcaseFish || 
        showcaseFish.userData.fishType !== playerProgress.selectedFish;
    
    if (needsNewFish) {
        // Remove old fish if it exists
        if (showcaseFish) {
            const rightArm = showcaseBear.getObjectByName('rightArm');
            if (rightArm && showcaseFish.parent === rightArm) {
                rightArm.remove(showcaseFish);
            }
            disposeObject(showcaseFish);
            showcaseFish = null;
        }

        // Create new fish
        showcaseFish = createFish(scene, 0, playerProgress.selectedFish, {}, false);
        showcaseFish.name = 'showcase-fish';
        showcaseFish.userData.fishType = playerProgress.selectedFish; // Track fish type
        if (showcaseFish.userData?.velocity) showcaseFish.userData.velocity.set(0, 0, 0);
        if (showcaseFish.userData) showcaseFish.userData.swimAmplitude = 0;
        
        // Attach fish to bear's hand
        const rightArm = showcaseBear.getObjectByName('rightArm');
        if (rightArm) {
            rightArm.add(showcaseFish);
            showcaseFish.position.set(0.1, -0.7, 0.4);
            showcaseFish.rotation.set(-Math.PI / 4, Math.PI / 2, Math.PI);
            showcaseFish.scale.set(0.5, 0.5, 0.5);
        } else {
             console.error("Showcase bear's right arm not found for fish attachment!");
        }
    }

    // Ensure showcase bear is visible
    if (showcaseBear) {
        showcaseBear.visible = true;
    }
}

function setupStartScreen() {
    gameState.current = 'IDLE';
    
    // Hide any active game objects (but not showcase objects)
    scene.children.forEach(child => {
        if ((child.name === 'bear' || child.name === 'fish') && !child.userData?.isShowcase) {
             child.visible = false;
        }
    });
    
    // Clear fish array, but actual objects are just hidden
    activeFishes.forEach(f => scene.remove(f));
    activeFishes = [];

    // Make sure game bear is fully gone
    if (bear) {
        disposeObject(bear);
        scene.remove(bear);
        bear = null;
    }

    populateUnlocks(playerProgress, (type, id) => {
        if (type === 'bear') playerProgress.selectedBear = id;
        if (type === 'fish') playerProgress.selectedFish = id;
        savePlayerProgress(playerProgress);

        const quickBearName = document.querySelector('#choose-bear span');
        const quickBearImg = document.querySelector('#choose-bear img');
        const quickFishName = document.querySelector('#choose-fish span');
        const quickFishImg = document.querySelector('#choose-fish img');

        const selectedBearInfo = BEARS.find(b => b.id === playerProgress.selectedBear);
        const selectedFishInfo = FISH.find(f => f.id === playerProgress.selectedFish);

        if(quickBearName) quickBearName.textContent = selectedBearInfo.name;
        if(quickBearImg) quickBearImg.src = selectedBearInfo.asset;
        if(quickFishName) quickFishName.textContent = selectedFishInfo.name;
        if(quickFishImg) quickFishImg.src = selectedFishInfo.asset;
        
        createOrUpdateShowcase();
    });
    
    createOrUpdateShowcase(); // Ensure showcase is visible and up to date
    showStart(isFirstLoad);
    isFirstLoad = false;
    startButton.innerText = 'START';
}

function startGame() {
    gameState = { current: 'PLAYING', score: 0, streak: 1 };
    
    // Hide the showcase bear instead of removing it
    if (showcaseBear) {
        showcaseBear.visible = false;
    }

    if (bear) scene.remove(bear);
    bear = createBear(playerProgress.selectedBear);
    scene.add(bear);

    bear.position.x = 0;
    updateUIValues({ score: gameState.score, streak: gameState.streak });
    showHUD();
    try { initAudio(); } catch (e) { /* ignore */ }

    activeFishes.forEach(f => scene.remove(f));
    activeFishes = [];
    resetSpawner();
}

function gameOver() {
    gameState.current = 'GAME_OVER';
    document.getElementById('final-score').innerText = gameState.score;

    if (gameState.score > playerProgress.highScore) {
        playerProgress.highScore = gameState.score;
    }
    let newUnlock = false;
    BEARS.forEach(b => {
        if (!playerProgress.unlockedBears.includes(b.id) && b.unlockCondition.type === 'score' && playerProgress.highScore >= b.unlockCondition.value) {
            playerProgress.unlockedBears.push(b.id);
            newUnlock = true;
        }
    });
    FISH.forEach(f => {
        if (!playerProgress.unlockedFish.includes(f.id) && f.unlockCondition.type === 'score' && playerProgress.highScore >= f.unlockCondition.value) {
            playerProgress.unlockedFish.push(f.id);
            newUnlock = true;
        }
    });

    savePlayerProgress(playerProgress);

    showGameOver();
    playSFX(sounds.splash);
    activeFishes.forEach(f => scene.remove(f));
    activeFishes = [];

    setTimeout(() => {
        const goScreen = document.getElementById('game-over-screen');
        if (goScreen) {
            goScreen.classList.add('fade-out');
            const onFadeOut = () => {
                goScreen.removeEventListener('animationend', onFadeOut);
                setupStartScreen();
                startButton.innerText = 'RETRY';
            };
            goScreen.addEventListener('animationend', onFadeOut);
        }
    }, 2000);
}

export function initGame() {
    setupStartScreen();
    startButton.addEventListener('click', startGame);
    wireAudioUnlock(initAudio);
}

export function updateGame() {
    if (gameState.current === 'PLAYING') {
        if (!bear) return;

        updateBear(bear, 0); // Direction is now handled by controls

        updateSpawner(scene, activeFishes, gameState.score, playerProgress);

        const catchZ = -0.8, failZ = -0.4;
        for (let i = activeFishes.length - 1; i >= 0; i--) {
            const f = activeFishes[i];
            updateFish(f);
            if (f.position.z >= catchZ) {
                const withinX = Math.abs(f.position.x - bear.position.x) <= (bear.userData.netWidth || 1) / 2;
                if (withinX) {
                    playSFX(sounds.catch);
                    gameState.score += 10 * gameState.streak;
                    gameState.streak++;
                    updateUIValues({ score: gameState.score, streak: gameState.streak });
                    scene.remove(f); activeFishes.splice(i,1);
                } else if (f.position.z > failZ) {
                    gameState.streak = 1;
                    updateUIValues({ score: gameState.score, streak: gameState.streak });
                    scene.remove(f); activeFishes.splice(i,1);
                    gameOver(); break;
                }
            }
        }
    } else if (gameState.current === 'GAME_OVER') {
        if (bear && bear.position.y > -10) {
            bear.position.add(gravity);
            bear.rotation.z += 0.05;
        }
    } else { // IDLE
        gameState.idleAnimTimer += 0.05;
        if (showcaseBear) {
            const rightArm = showcaseBear.getObjectByName('rightArm');
            if (rightArm) {
                const armBob = Math.sin(gameState.idleAnimTimer) * 0.1;
                rightArm.rotation.x = armBob;
            }
        }
    }
}