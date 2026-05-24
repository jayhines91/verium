// No console window on Windows — wallet UI only; logs go to debug.log in-app.
#![cfg_attr(windows, windows_subsystem = "windows")]

fn main() {
    verium_app_lib::run();
}
