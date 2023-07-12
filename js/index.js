import * as React from 'react'
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import * as d3 from 'd3';

/* export interface ImageTrackProps {
    elementSize: Size; // size of displayed image
    basepath: string; // parent directory for all images in this series
    imageSeries: string[]; // filenames of all images
    imageLength: number; // number of pixels in source image
    allTracks: TrackInfo[][]; // information for each track
  }
 */

function ViewModule(basePath, imgSeries, allTracks, imgSize) {

    useEffect(() => {
        console.log(basePath)
        console.log(imgSeries)
        console.log(allTracks)
        console.log(imgSize)
    }, [])

    return (
        <div>
            <img id="img1" />
            <svg id="svg1"></svg>
            <img id="img2" />
            <svg id="svg2"></svg>
        </div>
    );
}

const domNode = document.getElementById('viewer');
const root = createRoot(domNode);
root.render(<ViewModule
    basePath={document.getElementById("viewer").getAttribute("basePath")}
    imgSeries={document.getElementById("viewer").getAttribute("imgSeries")}
    allTracks={document.getElementById("viewer").getAttribute("allTracks")}
    imgSize={document.getElementById("viewer").getAttribute("imgSize")}
/>);
