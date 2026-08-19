mod consts;
mod context;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--version") {
        println!("{}", consts::SERVER_VERSION);
        return;
    }
    // Full server dispatch is added in Task 3/4.
    std::process::exit(0);
}
