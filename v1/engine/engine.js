/*
    LittleJS - The Little JavaScript Game Engine That Can - By Frank Force 2021

    Engine Features
    - Engine and debug system are separate from game code
    - Object oriented with base class engine object
    - Engine handles core update loop
    - Base class object handles update, physics, collision, rendering, etc
    - Engine helper classes and functions like Vector2, Color, and Timer
    - Super fast rendering system for tile sheets
    - Sound effects audio with zzfx and music with zzfxm
    - Input processing system with gamepad and touchscreen support
    - Tile layer rendering and collision system
    - Particle effect system
    - Automatically calls appInit(), appUpdate(), appUpdatePost(), appRender(), appRenderPost()
    - Debug tools and debug rendering system
    - Call engineInit() to start it up!
*/

'use strict';

///////////////////////////////////////////////////////////////////////////////
// engine config

const engineName = 'LittleJS';
const engineVersion = 'v0.74';
const FPS = 60, timeDelta = 1/FPS;
const defaultFont = 'arial'; // font used for text rendering
const maxWidth = 1920, maxHeight = 1200; // up to 1080p and 16:10
const fixedWidth = 0; // native resolution
//const fixedWidth = 1280, fixedHeight = 720; // 720p
//const fixedWidth = 128,  fixedHeight = 128; // PICO-8
//const fixedWidth = 240,  fixedHeight = 136; // TIC-80

// tile sheet settings
//const defaultTilesFilename = 'a.png'; // everything goes in one tile sheet
const defaultTileSize = vec2(16); // default size of tiles in pixels
const tileBleedShrinkFix = .3;    // prevent tile bleeding from neighbors
const pixelated = 1;              // use crisp pixels for pixel art

///////////////////////////////////////////////////////////////////////////////
// core engine

const gravity = -.01;
let mainCanvas=0, mainContext=0, mainCanvasSize=vec2();
let engineObjects=[], engineCollideObjects=[];
let frame=0, time=0, realTime=0, paused=0, frameTimeLastMS=0, frameTimeBufferMS=0, debugFPS=0;
let cameraPos=vec2(), cameraScale=4*max(defaultTileSize.x, defaultTileSize.y);
let tileImageSize, tileImageSizeInverse, shrinkTilesX, shrinkTilesY, drawCount;

const tileImage = new Image(); // the tile image used by everything
function engineInit(appInit, appUpdate, appUpdatePost, appRender, appRenderPost)
{
    // init engine when tiles load
    tileImage.onload = ()=>
    {
        // save tile image info
        tileImageSizeInverse = vec2(1).divide(tileImageSize = vec2(tileImage.width, tileImage.height));
        debug && (tileImage.onload=()=>ASSERT(1)); // tile sheet can not reloaded
        shrinkTilesX = tileBleedShrinkFix/tileImageSize.x;
        shrinkTilesY = tileBleedShrinkFix/tileImageSize.y;

        // setup html
        document.body.appendChild(mainCanvas = document.createElement('canvas'));
        document.body.style = 'margin:0;overflow:hidden;background:#000';
        mainCanvas.style = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);image-rendering:crisp-edges;image-rendering:pixelated';          // pixelated rendering
        mainContext = mainCanvas.getContext('2d');

        debugInit();
        glInit();
        appInit();
        engineUpdate();
    };

    // main update loop
    const engineUpdate = (frameTimeMS=0)=>
    {
        requestAnimationFrame(engineUpdate);
        
        if (!document.hasFocus())
            inputData[0].length = 0; // clear input when lost focus

        // prepare to update time
        const realFrameTimeDeltaMS = frameTimeMS - frameTimeLastMS;
        let frameTimeDeltaMS = realFrameTimeDeltaMS;
        frameTimeLastMS = frameTimeMS;
        realTime = frameTimeMS / 1e3;
        if (debug)
            frameTimeDeltaMS *= keyIsDown(107) ? 5 : keyIsDown(109) ? .2 : 1;
        if (!paused)
            frameTimeBufferMS += frameTimeDeltaMS;

        // update frame
        mousePosWorld = screenToWorld(mousePosScreen);
        updateGamepads();

        // apply time delta smoothing, improves smoothness of framerate in some browsers
        let deltaSmooth = 0;
        if (frameTimeBufferMS < 0 && frameTimeBufferMS > -9)
        {
            // force an update each frame if time is close enough (not just a fast refresh rate)
            deltaSmooth = frameTimeBufferMS;
            frameTimeBufferMS = 0;
            //debug && frameTimeBufferMS < 0 && console.log('time smoothing: ' + -deltaSmooth);
        }
        //debug && frameTimeBufferMS < 0 && console.log('skipped frame! ' + -frameTimeBufferMS);

        // clamp incase of extra long frames (slow framerate)
        frameTimeBufferMS = min(frameTimeBufferMS, 50);
        
        // update the frame
        for (;frameTimeBufferMS >= 0; frameTimeBufferMS -= 1e3 / FPS)
        {
            // main frame update
            appUpdate();
            engineUpdateObjects();
            appUpdatePost();
            debugUpdate();

            // update input
            for(let deviceInputData of inputData)
                deviceInputData.map(k=> k.r = k.p = 0);
            mouseWheel = 0;
        }

        // add the smoothing back in
        frameTimeBufferMS += deltaSmooth;

        if (fixedWidth)
        {
            // clear and fill window if smaller
            mainCanvas.width = fixedWidth;
            mainCanvas.height = fixedHeight;
            
            // fit to window width if smaller
            const fixedAspect = fixedWidth / fixedHeight;
            const aspect = innerWidth / innerHeight;
            mainCanvas.style.width = aspect < fixedAspect ? '100%' : '';
            mainCanvas.style.height = aspect < fixedAspect ? '' : '100%';
        }
        else
        {
            // fill the window
            mainCanvas.width = min(innerWidth, maxWidth);
            mainCanvas.height = min(innerHeight, maxHeight);
        }

        // save canvas size
        mainCanvasSize = vec2(mainCanvas.width, mainCanvas.height);
        mainContext.imageSmoothingEnabled = !pixelated; // disable smoothing for pixel art

        // render sort then render while removing destroyed objects
        glPreRender(mainCanvas.width, mainCanvas.height);
        appRender();
        engineObjects.sort((a,b)=> a.renderOrder - b.renderOrder);
        for(const o of engineObjects)
            o.destroyed || o.render();
        glCopyToContext(mainContext);
        appRenderPost();
        debugRender();

        if (showWatermark)
        {
            // update fps
            debugFPS = lerp(.05, 1e3/(realFrameTimeDeltaMS||1), debugFPS);
            mainContext.textAlign = 'right';
            mainContext.textBaseline = 'top';
            mainContext.font = '1em monospace';
            mainContext.fillStyle = '#000';
            const text = engineName + ' ' + engineVersion + ' / ' 
                + drawCount + ' / ' + engineObjects.length + ' / ' + debugFPS.toFixed(1);
            mainContext.fillText(text, mainCanvas.width-3, 3);
            mainContext.fillStyle = '#fff';
            mainContext.fillText(text, mainCanvas.width-2,2);
            drawCount = 0;
        }

        // copy anything left in the buffer if necessary
        glCopyToContext(mainContext);
    }
    //tileImage.src = 'finrip.png';
    tileImage.src = 'data:image/png;base64,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';
    }

function engineUpdateObjects()
{
    // recursive object update
    const updateObject = (o)=>
    {
        if (!o.destroyed)
        {
            o.update();
            for(const child of o.children)
                updateObject(child);
        }
    }
    for(const o of engineObjects)
        o.parent || updateObject(o);
    engineObjects = engineObjects.filter(o=>!o.destroyed);
    engineCollideObjects = engineCollideObjects.filter(o=>!o.destroyed);
    time = ++frame / FPS;
}

function forEachObject(pos, size=0, callbackFunction=(o)=>1, collideObjectsOnly=1)
{
    const objectList = collideObjectsOnly ? engineCollideObjects : engineObjects;
    if (!size)
    {
        // no overlap test
        for (const o of objectList)
            callbackFunction(o);
    }
    else if (size.x != undefined)
    {
        // aabb test
        for (const o of objectList)
            isOverlapping(pos, size, o.pos, o.size) && callbackFunction(o);
    }
    else
    {
        // circle test
        const sizeSquared = size**2;
        for (const o of objectList)
            pos.distanceSquared(o.pos) < sizeSquared && callbackFunction(o);
    }
}
