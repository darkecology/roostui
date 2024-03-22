# Adding new data to the website

## Deployment outputs
Deploying the [roost-system](https://github.com/darkecology/roost-system) produces four types of outputs: 
1. `ui`-required files, including
   1. `images` of the dz05 and vr05 channels to be visualized in the UI
   2. `csv` files for scans, bounding boxes, and per-sweep animal counts
2. radar `scans`, which are typically deleted during deployment to save disk space once `arrays` are rendered
3. rendered `arrays`
4. deployment `logs`.

In addition, 
5. `slurm_logs` are saved if the deployment happens on a server that uses slurm to manage jobs.

## Archiving and publishing deployment outputs
1. Clone this roostui repo to your local machine and pull the latest main branch.

2. File transferring:
   1. We run `tools/launch_demo.py` on the Swarm CPU cluster to process many station-years. 
   This script calls `tools/demo.sh`, which should both run the system and transfer outputs 
   from the Swarm server to the Doppler server where we host the UI and archive files.
   2. Alternatively, we can manually transfer ui-required files by `bash fetch.sh <dataset_name>`.

3. Initialize the new dataset in this roostui repo by `bash init_dataset.sh <dataset_name>`. This creates two files:
   1. `<dataset_name>/batches.txt`: list of batches
   2. `<dataset_name>/config.json`: configuration file

   Edit them if needed.

4. Add the new dataset to the main UI config file `data/config.json`.

5. Test the website locally according to the [README in parent directory](../README.md). 
   Usually this means running `yarn run serve` and then navigating to [http://localhost:8888]().

6. Publish the website on Doppler by running `bash publish.sh <website_name>` in the parent directory. 
   1. We currently use `ui` as the <website_name>.
   2. If your "local machine" is a directory on Doppler, run `bash publish_local.sh <website_name>` will do the same.
   
   **Now the latest results should be visible on the web UI!**

7. Finally,
   1. Commit and push your changes to Github.
   2. Clean files on Swarm to prevent out-of-space errors in furture deployment.
   3. `chmod` so that the directories on Doppler can be modified by teammates. 
   