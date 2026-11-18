# Working together without conflicts

`master` is the working version (the one that is demoed and deployed). Nobody pushes to `master` directly.
Each person works on his own branch and sends the work to `master` with a Pull Request on GitHub.

| branch | who | main area |
|---|---|---|
| `master` | stable version | merged work only |
| `kaif` | Kaif Ahmad | `backend/` (API, geocoder, database) |
| `ans` | Ans Abbas | data collection, testing, documents |
| `zaid` | Muhammad Zaid | `frontend/` (web app, rider app, map) |

Staying inside your own area is what avoids most conflicts. If you must change a file in someone else's area, tell him first.

## First time
    git clone https://github.com/Sudo-Zaid/addressiq.git
    cd addressiq
    git checkout kaif            # use your own branch name
    pip install -r backend/requirements.txt
    cd frontend && npm install && cd ..

Run it with `start.bat` (Windows), or see README.md.

## Every day, before you start
    git checkout kaif
    git pull origin master       # brings the newest stable code into your branch

## When you have done some work
    git add -A
    git commit -m "short sentence: what you changed"
    git push origin kaif

## When the work is finished and tested
Open https://github.com/Sudo-Zaid/addressiq , press **Compare & pull request** (`kaif` -> `master`),
write one line about what it does and press **Create pull request**. After a quick look it is merged into `master`.
Small pull requests (one feature or one fix) are merged quickly; big ones cause conflicts.

## If `git pull origin master` says CONFLICT
Open the listed files, find the lines between `<<<<<<<` and `>>>>>>>`, keep the correct version, delete the markers, then:

    git add -A
    git commit -m "merge master"

## Never commit
`data/app.sqlite` (local database), `tools/` (tunnel keys), `frontend/node_modules`, `.env` files. They are already in `.gitignore`.
