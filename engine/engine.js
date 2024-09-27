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

    //tileImage.src = 'tiles.png';
    tileImage.src = 
`data:image/png;base64,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`;
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
