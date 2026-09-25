rootProject.name = "quera-mirror"

// Gets a list of all files / dirs in services and includes them. Implicit 
// assumption that services/ only contains directories for services.
file("services").list()!!.forEach { include("services:$it") }
