/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

use dom::bindings::codegen::Bindings::HTMLBRElementBinding;
use dom::bindings::codegen::InheritTypes::HTMLBRElementDerived;
use dom::bindings::js::{JSRef, Temporary};
use dom::bindings::utils::{Reflectable, Reflector};
use dom::document::Document;
use dom::element::HTMLBRElementTypeId;
use dom::eventtarget::{EventTarget, NodeTargetTypeId};
use dom::htmlelement::HTMLElement;
use dom::node::{Node, ElementNodeTypeId};
use servo_util::str::DOMString;

#[deriving(Encodable)]
pub struct HTMLBRElement {
    pub htmlelement: HTMLElement,
}

impl HTMLBRElementDerived for EventTarget {
    fn is_htmlbrelement(&self) -> bool {
        self.type_id == NodeTargetTypeId(ElementNodeTypeId(HTMLBRElementTypeId))
    }
}

impl HTMLBRElement {
    pub fn new_inherited(localName: DOMString, document: &JSRef<Document>) -> HTMLBRElement {
        HTMLBRElement {
            htmlelement: HTMLElement::new_inherited(HTMLBRElementTypeId, localName, document)
        }
    }

    pub fn new(localName: DOMString, document: &JSRef<Document>) -> Temporary<HTMLBRElement> {
        let element = HTMLBRElement::new_inherited(localName, document);
        Node::reflect_node(box element, document, HTMLBRElementBinding::Wrap)
    }
}

pub trait HTMLBRElementMethods {
}

impl Reflectable for HTMLBRElement {
    fn reflector<'a>(&'a self) -> &'a Reflector {
        self.htmlelement.reflector()
    }
}
