# Adding new data to the website

Deploying the [roost-system](https://github.com/darkecology/roost-system) produces four types of outputs: 
radar `scans`, rendered `arrays`, deployment `logs`, and `ui`-required files. 
In addition, `slurm_logs` are saved if the deployment happens on a server that uses slurm to manage jobs.
- `ui`-required files include (1) dz05 and vr05 images to be visualized in the UI and 
(2) scan, bounding box, and per-sweep animal count lists saved in csv files.
- Other files are for reference and reusing only. 
Typically, `scans` are deleted during deployment to save disk space once `arrays` are rendered.

We use the slurm CPU cluster to perform large-scale deployment of the [roost-system](https://github.com/darkecology/roost-system). 
When we use `tools/launch_demo.py` to process station-years, commands in `tools/demo.sh` should 
both run the system and transfer outputs from swarm to the doppler server where we host the UI and archive files.

1. Clone this roostui repo to your local machine and pull the latest main branch, if not already. 
Add csv files to this repo, if not already, as follows. 
Under `data`, modify arguments in `fetch.sh` and run `bash fetch.sh <dataset_name>`. 
This will create a new directory `data/<dataset_name>` as needed and 
pull the csv files in `ui/scans_and_tracks` from swarm. 

2. Run `bash init_dataset.sh <dataset_name>`. This creates two files:
    * `<dataset_name>/config.json`: configuration file
    * `<dataset_name>/batches.txt`: list of batches

    Edit these files if needed.

3. Edit the main UI config file `data/config.json` to add your dataset.

    ~~~ json
    {"datasets" : ["train", "us_sunrise_v3", "<dataset_name>"]}
    ~~~

4. Test the website locally. See [README in parent directory](../README.md). Usually this means running `yarn run serve` and then navigating to [http://localhost:8888]().

5. From the root of this repo, publish the website on doppler by `bash publish.sh <website_name>`. 
We currently use `ui` as the <website_name>.
If your "local machine" is a directory on doppler, run `bash publish_local.sh <website_name>` will do the same.

7. Commit and push your changes to github. 
`chmod` so that the directories on doppler can be modified by teammates. 
Clean files on swarm to prevent out-of-space errors in furture deployment.
