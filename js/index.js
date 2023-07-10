import * as React from 'react'
import { createRoot } from 'react-dom/client';

import * as d3 from 'd3';

function ViewModule() {

    function render_dataset() {
        // If work needs saving, check if user wants to proceed
        if (window.onbeforeunload &&
            !window.confirm("Change dataset? You made changes but did not export data.")) {
            return;
        }
        window.onbeforeunload = null;

        let dataset = nav.dataset;
        if (dataset) {

            d3.select('#datasets').node().value = dataset;

            function handle_config(_config) {
                dataset_config = _config;
                if ("filtering" in dataset_config) {
                    Object.assign(filters, dataset_config["filtering"]);
                }
                else {
                    Object.assign(filters, default_filters);
                }
                render_filters();
            }

            function handle_batches(batch_list) {
                batch_list = batch_list.trim().split("\n");
                var batches = d3.select('#batches');
                var options = batches.selectAll("option")
                    .data(batch_list)
                    .join("option")
                    .text(d => d);
                batches.on("change", change_batch);

                // If the batch nav is not set already, used the selected value
                // from the dropdown list
                if (!nav.batch) {
                    nav.batch = batches.node().value;
                }
            }

            var batchFile = sprintf("data/%s/batches.txt", dataset);
            var dataset_config_file = sprintf("data/%s/config.json", dataset);

            Promise.all([
                d3.text(batchFile).then(handle_batches),
                d3.json(dataset_config_file).then(handle_config)
            ]).then(render_batch);
        }
    }


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
root.render(<ViewModule />);
