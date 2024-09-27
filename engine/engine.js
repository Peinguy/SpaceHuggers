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
