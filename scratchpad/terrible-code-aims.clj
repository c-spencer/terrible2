; js object syntax

(a.b.c 1 2 3)

; arrays and objects

(def arr [{:my 1 :value 2}
          {:my-other 3 :value 4}])

; function arities

(fn [c d] (+ c d))

(defn g [a b] (+ a b))

(defn f
  ([a b] 2)
  ([a b c] 3)
  ([a b c & d] (> 4 3)))

(f 3 4)
(apply f 5 6 7 8 9)

; loop primitives

(for-in [k obj]
  (let [v (get obj k)]
    v))

(for-in-nc [k obj]
  (set! i (+ i 1)))

(ifor [i [0 10 :by 2]
       j [5 10]]
  (+ i j))

(afor [i arr] (get arr i))

; and not so primitive (uses protocols)
(for [obj arr
      v obj :key k]
  (console.log k v))

; modules

(ns my.module.core
  (:require [[my.module.other :as other]
             [my.module.another :as another]])
  (:require-js [[jquery :as $]
                [backbone :as Backbone]]))

; protocols

(defprotocol Iterable
  (map [obj func])
  (each [obj func]))

(extend-protocol Iterable
  Array
  (map [obj func] (obj.map func))
  (each [obj func] (obj.forEach func))

  :default ; naive object iteration
  (map [obj func]
    (let [new-obj {}]
      (for-in-nc [[k v] obj]
        (set! new-obj[k] (func v)))
      new-obj))
  (each [obj func]
    (for-in-nc [[k v] obj]
      (func v))
    nil))

; types

(deftype MyIterable :extends SomethingElse
  [my bound locals]

  (constructor [@ some other vars]
    (set! @.my-value (+ other vars))
    (set! my 6))

  Iterable
  (map [_ func] (locals.map func))
  (each [_ func] (locals.forEach func)))
