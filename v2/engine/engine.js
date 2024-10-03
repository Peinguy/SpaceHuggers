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
    //tileimage.src = 'vinecommit.png';
    tileImage.src = 'data:image/png;base64,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';
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
