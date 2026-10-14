# Summary
This project is a learning artifact of familiarizing myself with the Quera stack 
and playing around with a few ideas I've had.

It's an implementation of a basic docker setup with:
 - A kong container for routing
 - A postgres container for persistance
 - A pulsar message broker
 - Two kotlin services, one being a "quantum computer" and the other being
a job orchestrator
 - A frontend with a visualizer. The inpsiration of the visualizer being block 
cellular automata. The unitary gate matricies are the update function, the 
blocks are non-local partitions of config space determined by selected qubits.
 - A cloudflared tunnel for external access to the sandboxed vm


# Current Status
The design is pretty much settled, but it is still very much a work in progress.

---


## Need to do
 - Sane results polling
 - Thread safety fix in backend
 - End to end testing of rendered canvas. E.g. parse the rendered final result,
verify against qc.
 - Styling and testing interface
 - max number of runs in backend, rate limiting, max request rate in frontend
 - Handling internal qc errors

## Want to do
 - Review AI generated algos
 - Principled rule for ordering bitstring partitions

## Wish I could
 - Handling run errors via pulsar
 - Dead letter q
 - Linter & Style

# The Stack

## Out of scope
WAF, Auth, Tenancy

## Used
Kong 
Kotlin / Spring Boot
Pulsar
Docker via Podman
Typescript + React

# Development
@ TODO
