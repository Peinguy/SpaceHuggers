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
