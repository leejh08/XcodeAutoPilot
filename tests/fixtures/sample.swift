import UIKit

class ViewModel {
    var count: Int = 0
    var unused: String = "hello"

    func updateCount(value: String) {
        // Error: cannot convert String to Int
        count = value
    }

    func fetchData() {
        let result = count * 2
        print(result)
    }
}

class Controller: UIViewController {
    var viewModel = ViewModel()

    override func viewDidLoad() {
        super.viewDidLoad()
        // Error: UIView has no member 'configure'
        view.configure()
        // Error: use of unresolved identifier
        dataSource.reload()
    }
}
