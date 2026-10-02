use std::env;
use std::process::{self, Command};

fn main() {
    let status = Command::new(r"C:\Windows\System32\wsl.exe")
        .arg("--exec")
        .arg("docker")
        .args(env::args_os().skip(1))
        .status();

    match status {
        Ok(status) => process::exit(status.code().unwrap_or(1)),
        Err(error) => {
            eprintln!("Falha ao executar Docker via WSL: {error}");
            process::exit(1);
        }
    }
}
