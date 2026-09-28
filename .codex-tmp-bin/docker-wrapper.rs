use std::env;
use std::process::{exit, Command};

fn main() {
    let status = Command::new(r"C:\Windows\System32\wsl.exe")
        .args(["-d", "Ubuntu", "--", "docker"])
        .args(env::args_os().skip(1))
        .status()
        .expect("failed to start Docker through WSL");

    exit(status.code().unwrap_or(1));
}
