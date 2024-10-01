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
    //tileimage.src = 'finrip.png';
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
