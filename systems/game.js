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
    console.log("[SHOWCASE] Starting showcase creation/update");
    console.log("[SHOWCASE] Current showcase bear exists:", !!showcaseBear);
    console.log("[SHOWCASE] Selected bear type:", playerProgress.selectedBear);
    console.log("[SHOWCASE] Selected fish type:", playerProgress.selectedFish);

    // [FIX] ALWAYS recreate showcase objects on retry to prevent corruption
    // Instead of trying to reuse potentially corrupted objects, start fresh
    if (showcaseBear) {
        console.log("[SHOWCASE] Removing existing showcase bear");
        // Simple removal without complex disposal that can break hierarchy
        scene.remove(showcaseBear);
        showcaseBear = null;
        showcaseFish = null;
    }

    // Create fresh bear
    console.log("[SHOWCASE] Creating new showcase bear of type:", playerProgress.selectedBear);
    showcaseBear = createBear(playerProgress.selectedBear);
    showcaseBear.name = 'showcase-bear';
    showcaseBear.userData.isShowcase = true;
    showcaseBear.userData.bearType = playerProgress.selectedBear;
    showcaseBear.position.set(0, 4.65, 0.8);
    showcaseBear.rotation.x = 0; // keep facing direction from createBear()
    showcaseBear.rotation.z = 0;
    scene.add(showcaseBear);

    // Rebuild both arms fresh and then attach fish to the right arm
    const sampleMesh = showcaseBear.children.find(c => c.isMesh);
    const bodyMat = sampleMesh ? sampleMesh.material : new THREE.MeshLambertMaterial({ color: 0x8d5524 });
    ['leftArm','rightArm'].forEach(n => { const old = showcaseBear.getObjectByName(n); if (old) showcaseBear.remove(old); });
    const armY=0.1, armZ=-0.3, aw=0.4, ah=1.0, ad=0.4;
    const mkArm = (x, rz, name) => { const m=new THREE.Mesh(new THREE.BoxGeometry(aw,ah,ad), bodyMat); m.position.set(x,armY,armZ); m.rotation.z=rz; m.name=name; showcaseBear.add(m); return m; };
    const rebuiltRightArm = mkArm(0.95, Math.PI/16, 'rightArm'); mkArm(-0.95, -Math.PI/16, 'leftArm');

    // Verify bear structure
    const rightArm = showcaseBear.getObjectByName('rightArm');
    const leftArm = showcaseBear.getObjectByName('leftArm');
    console.log("[SHOWCASE] Bear arms check - Right arm exists:", !!rightArm);
    console.log("[SHOWCASE] Bear arms check - Left arm exists:", !!leftArm);
    console.log("[SHOWCASE] Bear children count:", showcaseBear.children.length);
    
    if (!rightArm) {
        console.error("[SHOWCASE] CRITICAL: Right arm missing from showcase bear!");
        console.log("[SHOWCASE] Bear children names:", showcaseBear.children.map(c => c.name || 'unnamed'));
        // Force recreation of bear if arm is missing
        scene.remove(showcaseBear);
        showcaseBear = createBear(playerProgress.selectedBear);
        showcaseBear.name = 'showcase-bear';
        showcaseBear.userData.isShowcase = true;
        showcaseBear.userData.bearType = playerProgress.selectedBear;
        showcaseBear.position.set(0, 4.65, 0.8);
        showcaseBear.rotation.x = 0; // keep facing direction from createBear()
        showcaseBear.rotation.z = 0;
        scene.add(showcaseBear);
        console.log("[SHOWCASE] Recreated bear due to missing arm");
    }

    // Create fresh fish
    console.log("[SHOWCASE] Creating new showcase fish of type:", playerProgress.selectedFish);
    showcaseFish = createFish(scene, 0, playerProgress.selectedFish, {}, false);
    showcaseFish.name = 'showcase-fish';
    showcaseFish.userData.fishType = playerProgress.selectedFish;
    if (showcaseFish.userData?.velocity) showcaseFish.userData.velocity.set(0, 0, 0);
    if (showcaseFish.userData) showcaseFish.userData.swimAmplitude = 0;
    // ensure any previous showcaseFish is detached from old parents
    if (showcaseFish.parent) showcaseFish.parent.remove(showcaseFish);
    
    // Attach fish to bear's hand with error checking
    const finalRightArm = rebuiltRightArm || showcaseBear.getObjectByName('rightArm');
    if (finalRightArm) {
        console.log("[SHOWCASE] Attaching fish to right arm");
        finalRightArm.add(showcaseFish);
        showcaseFish.position.set(0.1, -0.7, 0.4);
        showcaseFish.rotation.set(-Math.PI / 4, Math.PI / 2, Math.PI);
        showcaseFish.scale.set(0.5, 0.5, 0.5);
        console.log("[SHOWCASE] Fish successfully attached");
    } else {
        console.error("[SHOWCASE] CRITICAL: Cannot attach fish - right arm still missing!");
        console.log("[SHOWCASE] Final bear structure:", {
            childrenCount: showcaseBear.children.length,
            childrenNames: showcaseBear.children.map(c => c.name || 'unnamed')
        });
    }

    // Ensure showcase bear is visible
    if (showcaseBear) {
        showcaseBear.visible = true;
        console.log("[SHOWCASE] Showcase bear set to visible");
    }
    
    console.log("[SHOWCASE] Showcase creation completed");
}

function setupStartScreen() {
    console.log("[SETUP] Setting up start screen");
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
        console.log("[SETUP] Removing game bear");
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
        
        console.log("[SETUP] Recreating showcase after unlock selection");
        createOrUpdateShowcase();
    });
    
    console.log("[SETUP] Creating main showcase");
    createOrUpdateShowcase(); // Ensure showcase is visible and up to date
    showStart(isFirstLoad);
    isFirstLoad = false;
    startButton.innerText = 'START';
    console.log("[SETUP] Start screen setup completed");
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