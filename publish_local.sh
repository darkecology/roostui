#!/bin/bash

NAME=${1:-ui-test}
DST=${2:-/var/www/html/roost/}

FULLPATH=$DST/$NAME

mkdir -p $FULLPATH
rsync -avz --include "index.html" --include "dist**" --include "data**" --exclude "*" --chmod=ug=rwX . $FULLPATH/
